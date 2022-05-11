/* eslint-disable prefer-const */
import forEach from "mocha-each";
import hre, { ethers, network, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";

import { BentoBoxV1, ERC20Mock, ILPStaking, BaseStargateLPStrategy } from "../typechain";
import { advanceTime, ChainId, getBigNumber, impersonate } from "../utilities";
import { Constants } from "./constants";

const cases = [
  ["Stargate USDC", "ArbitrumUsdcStargateLPStrategy", "0x9cd50907aeb5d16f29bddf7e1abb10018ee8717d"],
  ["Stargate USDT", "ArbitrumUsdtStargateLPStrategy", "0x9cd50907aeb5d16f29bddf7e1abb10018ee8717d"],
];

forEach(cases).describe(
  "%s Strategy",
  async (
    _name,
    deploymentName,
    lpWhale
  ) => {
  let snapshotId;
  let Strategy: BaseStargateLPStrategy;
  let StargateToken: ERC20Mock;
  let BentoBox: BentoBoxV1;
  let LpToken: ERC20Mock;
  let LPStaking: ILPStaking;
  let deployerSigner;
  let aliceSigner;
  let pid;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.ARBITRUM_RPC_URL,
            blockNumber: 11542332,
          },
        },
      ],
    });

    hre.getChainId = () => Promise.resolve(ChainId.Arbitrum.toString());
    await deployments.fixture(["StargateStrategies"]);
    const { deployer, alice } = await getNamedAccounts();

    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", Constants.arbitrum.degenBox);

    const degenBoxOwner = await BentoBox.owner();
    await impersonate(degenBoxOwner);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract(deploymentName);
    LPStaking = await ethers.getContractAt<ILPStaking>("ILPStaking", Constants.mainnet.stargate.staking);
    LpToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", (await Strategy.strategyToken()));
    StargateToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", (await Strategy.stargateToken()));
    pid = await Strategy.pid();

    await impersonate(lpWhale);
    const lpWhaleSigner = await ethers.getSigner(lpWhale);
    await LpToken.connect(lpWhaleSigner).transfer(alice, await LpToken.balanceOf(lpWhale));

    const aliceLpAmount = await LpToken.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);
    
    // Deposit into DegenBox
    const balanceBefore = (await BentoBox.totals(LpToken.address)).elastic;
    await LpToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(LpToken.address, alice, alice, aliceLpAmount, 0);
    let bentoBoxCakeAmount = (await BentoBox.totals(LpToken.address)).elastic;
    expect(bentoBoxCakeAmount.sub(balanceBefore)).to.equal(aliceLpAmount);

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);

    bentoBoxCakeAmount = (await BentoBox.totals(LpToken.address)).elastic;
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 70);

    // Initial Rebalance, calling skim to deposit to cakepool
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await LpToken.balanceOf(Strategy.address)).to.equal(0);

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
    await Strategy.safeHarvest(0, false, 0,  false);

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
    await Strategy.safeHarvest(0, false, 0,  false);
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
