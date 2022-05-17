/* eslint-disable prefer-const */
import forEach from "mocha-each";
import hre, { ethers, network, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";

import { BentoBoxV1, ERC20Mock, ILPStaking, IStargateRouter, StargateLPStrategy } from "../typechain";
import { advanceBlockTo, advanceTime, ChainId, getBigNumber, impersonate } from "../utilities";
import { Constants } from "./constants";

const cases = [
  [
    "Avalanche Stargate USDT",
    "avalanche",
    ChainId.Avalanche,
    "https://api.avax.network/ext/bc/C/rpc",
    14793964,
    "AvalancheUsdtStargateLPStrategyV1",
    "0x5754284f345afc66a98fbb0a0afe71e0f007b949",
  ],
  [
    "Avalanche Stargate USDC",
    "avalanche",
    ChainId.Avalanche,
    "https://api.avax.network/ext/bc/C/rpc",
    14793964,
    "AvalancheUsdcStargateLPStrategyV1",
    "0x625e7708f30ca75bfd92586e17077590c60eb4cd",
  ],
  [
    "Arbitrum Stargate USDT",
    "arbitrum",
    ChainId.Arbitrum,
    process.env.ARBITRUM_RPC_URL,
    12247893,
    "ArbitrumUsdtStargateLPStrategyV1",
    "0x7f90122BF0700F9E7e1F688fe926940E8839F353",
  ],
  [
    "Arbitrum Stargate USDC",
    "arbitrum",
    ChainId.Arbitrum,
    process.env.ARBITRUM_RPC_URL,
    12247893,
    "ArbitrumUsdcStargateLPStrategyV1",
    "0xce2cc46682e9c6d5f174af598fb4931a9c0be68e",
  ],
];

forEach(cases).describe("%s Strategy", async (_name, chain, chainId, jsonRpcUrl, blockNumber, deploymentName, whale) => {
  let snapshotId;
  let Strategy: StargateLPStrategy;
  let StargateToken: ERC20Mock;
  let BentoBox: BentoBoxV1;
  let LpToken: ERC20Mock;
  let UnderlyingToken: ERC20Mock;
  let LPStaking: ILPStaking;
  let Router: IStargateRouter;
  let deployerSigner;
  let aliceSigner;
  let pid;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl,
            blockNumber,
          },
        },
      ],
    });

    hre.getChainId = () => Promise.resolve(chainId.toString());
    await deployments.fixture(["StargateStrategies"]);
    const { deployer, alice } = await getNamedAccounts();

    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", Constants[chain].degenBox);

    const degenBoxOwner = await BentoBox.owner();
    await impersonate(degenBoxOwner);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract(deploymentName);
    LPStaking = await ethers.getContractAt<ILPStaking>("ILPStaking", Constants[chain].stargate.staking);
    LpToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", await Strategy.strategyToken());
    UnderlyingToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", await Strategy.underlyingToken());
    StargateToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", await Strategy.stargateToken());
    Router = await ethers.getContractAt<IStargateRouter>("IStargateRouter", await Strategy.router());
    pid = await Strategy.pid();

    await impersonate(whale);
    const whaleSigner = await ethers.getSigner(whale);
    await UnderlyingToken.connect(whaleSigner).approve(Router.address, ethers.constants.MaxUint256);
    await Router.connect(whaleSigner).addLiquidity(await Strategy.poolId(), getBigNumber(20_000_000, 6), alice);
    const aliceLpAmount = await LpToken.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);

    // Deposit into DegenBox
    const balanceBefore = (await BentoBox.totals(LpToken.address)).elastic;
    await LpToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(LpToken.address, alice, alice, aliceLpAmount, 0);
    let bentoLPAmount = (await BentoBox.totals(LpToken.address)).elastic;
    expect(bentoLPAmount.sub(balanceBefore)).to.equal(aliceLpAmount);

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);

    bentoLPAmount = (await BentoBox.totals(LpToken.address)).elastic;
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 70);

    // Initial Rebalance, calling skim to deposit to pool
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await LpToken.balanceOf(Strategy.address)).to.equal(0);

    const poolInfo = await LPStaking.poolInfo(pid);
    const blockTo = poolInfo.lastRewardBlock.toNumber() + 100;
    console.log(`Advancing to block number ${blockTo}...`);
    await advanceBlockTo(blockTo);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should be able to change the fee collector only by the owner", async () => {
    const [deployer, alice] = await ethers.getSigners();
    await expect(Strategy.connect(alice).setFeeParameters(alice.address, 10)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployer).setFeeParameters(alice.address, 10));

    expect(await Strategy.feeCollector()).to.eq(alice.address);
  });

  it("should mint lp from rewards and take 10%", async () => {
    const { deployer } = await getNamedAccounts();

    await Strategy.setFeeParameters(deployer, 10);
    await Strategy.safeHarvest(0, false, 0, false);

    const feeCollector = await Strategy.feeCollector();
    const balanceFeeCollectorBefore = await LpToken.balanceOf(feeCollector);
    const balanceBefore = await LpToken.balanceOf(Strategy.address);
    const tx = await Strategy.swapToLP(0);
    const balanceAfter = await LpToken.balanceOf(Strategy.address);
    const balanceFeeCollectorAfter = await LpToken.balanceOf(feeCollector);

    // Strategy should now have more LP
    expect(balanceAfter.sub(balanceBefore)).to.be.gt(0);

    // FeeCollector should have received some LP
    expect(balanceFeeCollectorAfter.sub(balanceFeeCollectorBefore)).to.be.gt(0);

    await expect(tx).to.emit(Strategy, "LpMinted");
  });

  it("should avoid front running when minting lp", async () => {
    await Strategy.safeHarvest(0, false, 0, false);
    await expect(Strategy.swapToLP(getBigNumber(2, 14))).to.revertedWith("INSUFFICIENT_AMOUNT_OUT");
  });

  it("should harvest harvest, mint lp and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false);
    await Strategy.swapToLP(0);

    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    const newBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;
    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should rebalance and withdraw lp to degenbox", async () => {
    const oldBentoBalance = await LpToken.balanceOf(BentoBox.address);
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 50);
    await expect(Strategy.safeHarvest(0, true, 0, false)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should exit the strategy properly", async () => {
    const oldBentoBalance = await LpToken.balanceOf(BentoBox.address);

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false);
    await Strategy.swapToLP(0);

    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await LpToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
