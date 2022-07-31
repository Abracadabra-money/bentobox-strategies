/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";
import { BentoBoxV1, ERC20Mock, IERC20, IVelodromeGauge, IVelodromeRouter, VelodromeGaugeVolatileLPStrategy } from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";
import { Constants } from "./constants";

const opWhale = "0x2501c477D0A35545a387Aa4A3EEe4292A9a8B3F0";
const usdcWhale = "0xAD7b4C162707E0B2b5f6fdDbD3f8538A5fbA0d60";

describe("Velodrome vOP/USDC LP Strategy", async () => {
  let snapshotId;
  let Strategy: VelodromeGaugeVolatileLPStrategy;
  let BentoBox: BentoBoxV1;
  let LpToken: IERC20;
  let VeloToken: ERC20Mock;
  let OpToken: ERC20Mock;
  let UsdcToken: ERC20Mock;
  let Gauge: IVelodromeGauge;
  let deployerSigner;
  let aliceSigner;
  let gaugeProxySigner;

  const distributeReward = async (amount = getBigNumber(50_000)) => {
    await advanceTime(1210000);
    const rewardDistributor = "0x5d5Bea9f0Fc13d967511668a60a3369fD53F784F";
    await impersonate(rewardDistributor);
    const rewardDistributorSigner = await ethers.getSigner(rewardDistributor);
    
    await VeloToken.connect(rewardDistributorSigner).transfer(gaugeProxySigner.address, amount);
    await VeloToken.connect(gaugeProxySigner).approve(Gauge.address, 0);
    await VeloToken.connect(gaugeProxySigner).approve(Gauge.address, amount);
    await Gauge.connect(gaugeProxySigner).notifyRewardAmount(VeloToken.address, amount);

    await VeloToken.connect(rewardDistributorSigner).transfer(Strategy.address, getBigNumber(654_342));
  };

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            enabled: true,
            jsonRpcUrl: "https://mainnet.optimism.io",
            blockNumber: 16849588,
          },
        },
      ],
    });

    await deployments.fixture(["LimoneVelodromeVolatileOpUsdcStrategy"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(Constants.optimism.velodrome.vOpUsdcGauge);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    gaugeProxySigner = await ethers.getSigner(Constants.optimism.velodrome.vOpUsdcGauge);

    Strategy = await ethers.getContract("LimoneVelodromeVolatileOpUsdcStrategy");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", Constants.optimism.limone);
    Gauge = await ethers.getContractAt<IVelodromeGauge>("IVelodromeGauge", Constants.optimism.velodrome.vOpUsdcGauge);
    LpToken = await ethers.getContractAt<IERC20>("ERC20Mock", Constants.optimism.velodrome.vOpUsdc);
    VeloToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", Constants.optimism.velodrome.velo);
    OpToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", Constants.optimism.op);
    UsdcToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", Constants.optimism.usdc);

    const VelodromeRouter = await ethers.getContractAt<IVelodromeRouter>("IVelodromeRouter", Constants.optimism.velodrome.router);

    const degenBoxOwner = await BentoBox.owner();
    await impersonate(degenBoxOwner);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    // Transfer LPs from a holder to alice
    await impersonate(opWhale);
    await impersonate(usdcWhale);
    const opWhaleSigner = await ethers.getSigner(opWhale);
    const usdcWhaleSigner = await ethers.getSigner(usdcWhale);
    await OpToken.connect(opWhaleSigner).transfer(alice, getBigNumber(1000, 18));
    await UsdcToken.connect(usdcWhaleSigner).transfer(alice, getBigNumber(5000, 6));
    await OpToken.connect(aliceSigner).approve(VelodromeRouter.address, ethers.constants.MaxUint256);
    await UsdcToken.connect(aliceSigner).approve(VelodromeRouter.address, ethers.constants.MaxUint256);
    await VelodromeRouter.connect(aliceSigner).addLiquidity(
      OpToken.address,
      UsdcToken.address,
      false,
      getBigNumber(1000, 18),
      getBigNumber(5000, 6),
      0,
      0,
      alice,
      ethers.constants.MaxUint256
    );

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
    expect(await VeloToken.balanceOf(Strategy.address)).to.eq(0);

    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should farm rewards", async () => {
    let previousAmount = await VeloToken.balanceOf(Strategy.address);

    await distributeReward();
    await Strategy.safeHarvest(ethers.constants.MaxUint256, false, 0, false);

    const amount = await VeloToken.balanceOf(Strategy.address);

    expect(amount).to.be.gt(previousAmount);
    previousAmount = amount;
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

    await distributeReward();
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
  
  it("should harvest harvest, mint lp and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(LpToken.address)).elastic;

    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false); // harvest spirit
    await Strategy.swapToLP(0); // mint new ftm/mimlp from harvest spirit

    // harvest spirit, report lp profit to bentobox
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

    await distributeReward();
    await Strategy.safeHarvest(0, false, 0, false); // harvest spirit
    await Strategy.swapToLP(0); // mint lp from harvested rewards

    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(LpToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await LpToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await LpToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
