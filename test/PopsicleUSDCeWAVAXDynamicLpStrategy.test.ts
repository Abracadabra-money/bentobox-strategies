/* eslint-disable prefer-const */
import { ethers, network, deployments } from "hardhat";
import { expect } from "chai";

import {
  BentoBoxV1,
  DynamicLPStrategy,
  DynamicSubLPStrategy,
  IERC20,
  IMasterChef,
} from "../typechain";
import { advanceTime, getBigNumber, impersonate } from "../utilities";

describe("Popsicle USDC.e/WAVAX Dynamic LP Strategy", async () => {
  let snapshotId;
  let Strategy: DynamicLPStrategy;
  let DegenBox: BentoBoxV1;

  let PngSubStrategy: DynamicSubLPStrategy;
  let JoeSubStrategy: DynamicSubLPStrategy;

  let JoeLP: IERC20;
  let PengolinLP: IERC20;

  let JoeToken: IERC20;
  let PngToken: IERC20;

  let MasterChefJoe: IMasterChef;
  let MasterChefPng: IMasterChef;

  let initialStakedLpAmount;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            enabled: true,
            jsonRpcUrl: `https://api.avax.network/ext/bc/C/rpc`,
            blockNumber: 11905974,
          },
        },
      ],
    });

    await deployments.fixture(["PopsicleUSDCeWAVAXDynamicLPStrategy"]);
    const [deployer, alice] = await ethers.getSigners();

    Strategy = await ethers.getContract<DynamicLPStrategy>("Popsicle_UsdceWavaxJLP_DynamicLPStrategy");
    DegenBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", "0xD825d06061fdc0585e4373F0A3F01a8C02b0e6A4");

    const degenBoxOwner = await DegenBox.owner();
    await impersonate(degenBoxOwner);
    const degenBoxOnwerSigner = await ethers.getSigner(degenBoxOwner);

    MasterChefJoe = await ethers.getContractAt<IMasterChef>("IMasterChef", "0xd6a4F121CA35509aF06A0Be99093d08462f53052");
    MasterChefPng = await ethers.getContractAt<IMasterChef>("IMasterChef", "0x1f806f7C8dED893fd3caE279191ad7Aa3798E928");

    JoeSubStrategy= await ethers.getContract<DynamicSubLPStrategy>("Popsicle_UsdceWavaxJLP_DynamicSubLPStrategy");
    PngSubStrategy = await ethers.getContract<DynamicSubLPStrategy>("Popsicle_UsdceWavaxPLP_DynamicSubLPStrategy");

    JoeLP = await ethers.getContractAt<IERC20>("ERC20Mock", "0xA389f9430876455C36478DeEa9769B7Ca4E3DDB1");
    PengolinLP = await ethers.getContractAt<IERC20>("ERC20Mock", "0xbd918Ed441767fe7924e99F6a0E0B568ac1970D9");

    JoeToken = await ethers.getContractAt<IERC20>("ERC20Mock", "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd");
    PngToken = await ethers.getContractAt<IERC20>("ERC20Mock", "0x60781C2586D68229fde47564546784ab3fACA982");

    // Transfer LPs from a holder to alice
    const lpHolder = "0x8361dde63f80a24256657d19a5b659f2fb9df2ab";
    await impersonate(lpHolder);
    const lpHolderSigner = await ethers.getSigner(lpHolder);
    const lpAmount = await JoeLP.balanceOf(lpHolder);
    // Deposit into DegenBox
    await JoeLP.connect(lpHolderSigner).approve(DegenBox.address, ethers.constants.MaxUint256);
    await DegenBox.connect(lpHolderSigner).deposit(JoeLP.address, lpHolder, alice.address, lpAmount, 0);

    // Activate strategy
    DegenBox = DegenBox.connect(degenBoxOnwerSigner);
    await DegenBox.setStrategy(JoeLP.address, Strategy.address);
    await advanceTime(1210000);
    await DegenBox.setStrategy(JoeLP.address, Strategy.address);
    await DegenBox.setStrategyTargetPercentage(JoeLP.address, 70);

    // Initial Rebalance, calling skim to deposit to masterchef
    await Strategy.safeHarvest(ethers.constants.MaxUint256, true, 0);
    expect(await JoeLP.balanceOf(Strategy.address)).to.eq(0);
    expect(await JoeToken.balanceOf(Strategy.address)).to.eq(0);

    // verify if the lp has been deposited to masterchef by the current strategy.
    let subStrategy = await Strategy.currentSubStrategy();
    const { amount } = await MasterChefJoe.userInfo(39, subStrategy);
    initialStakedLpAmount = lpAmount.mul(70).div(100);
    expect(amount).to.eq(initialStakedLpAmount);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await network.provider.send("evm_revert", [snapshotId]);
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  it("should farm joe rewards", async () => {
    let previousAmount = await JoeToken.balanceOf(Strategy.address);
    let subStrategy = await Strategy.currentSubStrategy();

    for (let i = 0; i < 10; i++) {
      await advanceTime(1210000);
      await Strategy.safeHarvest(ethers.constants.MaxUint256, false, 0);
      const amount = await JoeToken.balanceOf(subStrategy);

      expect(amount).to.be.gt(previousAmount);
      previousAmount = amount;
    }
  });
});
