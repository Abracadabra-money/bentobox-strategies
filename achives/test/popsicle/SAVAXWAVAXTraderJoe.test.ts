/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { BentoBoxV1, ERC20Mock, IERC20, ISpiritSwapGauge, MasterChefLPStrategy } from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";
import { Constants } from "./constants";

const degenBox = Constants.avalanche.limone;
const spiritToken = Constants.avalanche.joe;
const pair = Constants.avalanche.traderjoe.savaxWavax;
const pairWhale = "0xD3C8cd44D0196631Eaa7c59aFd4Db97Da5D6805A";

describe("TraderJoe sAVAX/wAVAX LP Strategy", async () => {
  let snapshotId;
  let Strategy: MasterChefLPStrategy;
  let BentoBox: BentoBoxV1;
  let LpToken: IERC20;
  let SpiritToken: ERC20Mock;
  let deployerSigner;
  let aliceSigner;

  const distributeReward = async () => {
    await advanceTime(1210000);
  };

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            enabled: true,
            jsonRpcUrl: `https://api.avax.network/ext/bc/C/rpc`,
            blockNumber: 15211086,
          },
        },
      ],
    });

    await deployments.fixture(["LimonSAVAXWAVAXTraderJoe"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(Constants.fantom.spiritswap.gaugeProxy);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);

    Strategy = await ethers.getContract("PopsicleWAvaxSavaxTraderJoeStrategy");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);
    LpToken = await ethers.getContractAt<IERC20>("ERC20Mock", pair);
    SpiritToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", spiritToken);

    const degenBoxOwner = await BentoBox.owner();
    await impersonate(degenBoxOwner);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    // Transfer LPs from a holder to alice
    await impersonate(pairWhale);
    const lpHolderSigner = await ethers.getSigner(pairWhale);
    await LpToken.connect(lpHolderSigner).transfer(alice, await LpToken.balanceOf(pairWhale));

    const aliceLpAmount = await LpToken.balanceOf(alice);
    expect(aliceLpAmount).to.be.gt(0);

    // Deposit into DegenBox
    await LpToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(LpToken.address, alice, alice, aliceLpAmount, 0);

    const lpAmount = (await BentoBox.totals(LpToken.address)).elastic;

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(LpToken.address, Strategy.address);
    await BentoBox.setStrategyTargetPercentage(LpToken.address, 70);

    // Initial Rebalance, calling skim to deposit to the gauge
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await LpToken.balanceOf(Strategy.address)).to.equal(0);
    expect(await SpiritToken.balanceOf(Strategy.address)).to.eq(0);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should farm spirit rewards", async () => {
    let previousAmount = await SpiritToken.balanceOf(Strategy.address);

    await distributeReward();
    await Strategy.safeHarvest(ethers.constants.MaxUint256, false, 0, false);

    const amount = await SpiritToken.balanceOf(Strategy.address);

    expect(amount).to.be.gt(previousAmount);
    previousAmount = amount;
  });

  it("should be able to change the fee collector only by the owner", async () => {
    const [deployer, alice] = await ethers.getSigners();
    await expect(Strategy.connect(alice).setFeeParameters(alice.address, 10)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployer).setFeeParameters(alice.address, 10));

    expect(await Strategy.feeCollector()).to.eq(alice.address);
  });

  it("should mint lp from joe rewards and take 10%", async () => {
    const { deployer } = await getNamedAccounts();
    await Strategy.setFeeParameters(deployer, 10);

    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false);

    const feeCollector = await Strategy.feeCollector();
    const balanceFeeCollectorBefore = await LpToken.balanceOf(feeCollector);
    const balanceBefore = await LpToken.balanceOf(Strategy.address);
    const tx = await Strategy.swapToLP(0, Constants.avalanche.joe);
    const balanceAfter = await LpToken.balanceOf(Strategy.address);
    const balanceFeeCollectorAfter = await LpToken.balanceOf(feeCollector);

    // Strategy should now have more LP
    expect(balanceAfter.sub(balanceBefore)).to.be.gt(0);

    // FeeCollector should have received some LP
    expect(balanceFeeCollectorAfter.sub(balanceFeeCollectorBefore)).to.be.gt(0);

    await expect(tx).to.emit(Strategy, "LpMinted");
  });

  it("should mint lp from qi rewards and take 10%", async () => {
    const { deployer } = await getNamedAccounts();
    await Strategy.setFeeParameters(deployer, 10);

    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false);

    const feeCollector = await Strategy.feeCollector();
    const balanceFeeCollectorBefore = await LpToken.balanceOf(feeCollector);
    const balanceBefore = await LpToken.balanceOf(Strategy.address);
    const tx = await Strategy.swapToLP(0, Constants.avalanche.qi);
    const balanceAfter = await LpToken.balanceOf(Strategy.address);
    const balanceFeeCollectorAfter = await LpToken.balanceOf(feeCollector);

    // Strategy should now have more LP
    expect(balanceAfter.sub(balanceBefore)).to.be.gt(0);

    // FeeCollector should have received some LP
    expect(balanceFeeCollectorAfter.sub(balanceFeeCollectorBefore)).to.be.gt(0);

    await expect(tx).to.emit(Strategy, "LpMinted");
  });

  it("should avoid front running when minting lp", async () => {
    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false);
    await expect(Strategy.swapToLP(getBigNumber(10), Constants.avalanche.joe)).to.revertedWith("InsufficientAmountOut");
  });

  it("should harvest harvest, mint lp and report a profit", async () => {
    let oldBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;

    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false);
    await Strategy.swapToLP(0, Constants.avalanche.joe);

    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    expect((await BentoBox.totals(LpToken.address)).elastic).to.be.gt(oldBentoBalance);

    oldBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;
    await Strategy.swapToLP(0, Constants.avalanche.qi);
    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    expect((await BentoBox.totals(LpToken.address)).elastic).to.be.gt(oldBentoBalance);
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

    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false);
    await Strategy.swapToLP(0, Constants.avalanche.joe);
    await Strategy.swapToLP(0, Constants.avalanche.qi);

    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await LpToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
