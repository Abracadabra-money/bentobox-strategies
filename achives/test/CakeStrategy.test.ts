/* eslint-disable prefer-const */
import { ethers, network, deployments, getNamedAccounts } from "hardhat";
import { expect } from "chai";

import { BentoBoxV1, ICakePool, ERC20Mock, CakeStrategyV2 } from "../typechain";
import { advanceTime, duration, getBigNumber, impersonate } from "../utilities";
import { Constants } from "./constants";

const degenBox = Constants.bsc.degenBox;
const degenBoxOwner = "0xfddfE525054efaAD204600d00CA86ADb1Cc2ea8a";
const cakeToken = Constants.bsc.pancakeSwap.cake;
const cakePool = Constants.bsc.pancakeSwap.cakePool;

// Transfer LPs from a holder to alice
const cakeWhale = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";

describe("Cake DegenBox Strategy V2", async () => {
  let snapshotId;
  let Strategy: CakeStrategyV2;
  let BentoBox: BentoBoxV1;
  let CakeToken: ERC20Mock;
  let CakePool: ICakePool;
  let initialStakedAmount;
  let deployerSigner;
  let aliceSigner;

  const addRewards = async(amount) => {
    const owner = await CakeToken.owner(); 
    await impersonate(owner);
    const signer = await ethers.getSigner(owner);
    const before = await CakePool.balanceOf();
    await CakeToken.connect(signer).transfer(CakePool.address, amount);
    expect((await CakePool.balanceOf()).sub(before)).to.eq(amount);
    await advanceTime(1210000);
  };

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            enabled: true,
            jsonRpcUrl: process.env.BSC_RPC_URL,
            blockNumber: 17318335,
          },
        },
      ],
    });

    await deployments.fixture(["CakeStrategy"]);
    const { deployer, alice } = await getNamedAccounts();

    await impersonate(degenBoxOwner);

    deployerSigner = await ethers.getSigner(deployer);
    aliceSigner = await ethers.getSigner(alice);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    Strategy = await ethers.getContract("CakeStrategyV2");
    BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", degenBox);
    CakePool = await ethers.getContractAt<ICakePool>("ICakePool", cakePool);
    CakeToken = await ethers.getContractAt<ERC20Mock>("ERC20Mock", cakeToken);

    await impersonate(cakeWhale);
    const cakeWhaleSigner = await ethers.getSigner(cakeWhale);
    await CakeToken.connect(cakeWhaleSigner).transfer(alice, await CakeToken.balanceOf(cakeWhale));

    const aliceCakeAmount = await CakeToken.balanceOf(alice);
    expect(aliceCakeAmount).to.be.gt(0);
    
    // Deposit into DegenBox
    const balanceBefore = (await BentoBox.totals(CakeToken.address)).elastic;
    await CakeToken.connect(aliceSigner).approve(BentoBox.address, ethers.constants.MaxUint256);
    await BentoBox.connect(aliceSigner).deposit(CakeToken.address, alice, alice, aliceCakeAmount, 0);
    let bentoBoxCakeAmount = (await BentoBox.totals(CakeToken.address)).elastic;
    expect(bentoBoxCakeAmount.sub(balanceBefore)).to.equal(aliceCakeAmount);

    BentoBox = BentoBox.connect(degenBoxOnwerSigner);
    await BentoBox.setStrategy(CakeToken.address, Strategy.address);
    await advanceTime(1210000);
    await BentoBox.setStrategy(CakeToken.address, Strategy.address);

    bentoBoxCakeAmount = (await BentoBox.totals(CakeToken.address)).elastic;
    await BentoBox.setStrategyTargetPercentage(CakeToken.address, 70);

    // Initial Rebalance, calling skim to deposit to cakepool
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0, false);
    expect(await CakeToken.balanceOf(Strategy.address)).to.equal(0);

    // verify if the cakes has been deposited to cakepool
    const { cakeAtLastUserAction } = (await CakePool.userInfo(Strategy.address));
    initialStakedAmount = bentoBoxCakeAmount.mul(70).div(100);
    expect(await Strategy.totalDepositAmount()).to.eq(initialStakedAmount);
    expect(cakeAtLastUserAction).to.be.closeTo(initialStakedAmount, 1);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should be able to change the fee collector only my the owner", async () => {
    expect(await Strategy.feeCollector()).to.eq(await Strategy.owner());

    await expect(Strategy.connect(aliceSigner).setFeeCollector(aliceSigner.address, 0)).to.revertedWith("Ownable: caller is not the owner");
    await expect(Strategy.connect(deployerSigner).setFeeCollector(aliceSigner.address, 11));

    expect(await Strategy.feeCollector()).to.eq(aliceSigner.address);
    expect(await Strategy.fee()).to.eq(11);
  });

  it("should harvest and report a profit", async () => {
    const oldBentoBalance = (await BentoBox.totals(CakeToken.address)).elastic;

    await addRewards(getBigNumber(1000));

    // harvest cake, report profit to bentobox
    await expect(Strategy.safeHarvest(0, false, 0, false)).to.emit(BentoBox, "LogStrategyProfit");
    const newBentoBalance = (await BentoBox.totals(CakeToken.address)).elastic;
    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should rebalance and withdraw CAKE to degenbox", async () => {
    const oldBentoBalance = await CakeToken.balanceOf(BentoBox.address);
    await BentoBox.setStrategyTargetPercentage(CakeToken.address, 50);
    await expect(Strategy.safeHarvest(0, true, 0, false)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await CakeToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
  });

  it("should exit the strategy properly", async () => {
    const oldBentoBalance = await CakeToken.balanceOf(BentoBox.address);

    await advanceTime(1210000);
    await Strategy.safeHarvest(0, false, 0, false); // harvest joe

    await expect(BentoBox.setStrategy(CakeToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyQueued");
    await advanceTime(1210000);
    await expect(BentoBox.setStrategy(CakeToken.address, Strategy.address)).to.emit(BentoBox, "LogStrategyDivest");
    const newBentoBalance = await CakeToken.balanceOf(BentoBox.address);

    expect(newBentoBalance).to.be.gt(oldBentoBalance);
    expect(await CakeToken.balanceOf(Strategy.address)).to.eq(0);
  });
});
