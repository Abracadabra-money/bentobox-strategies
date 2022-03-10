import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, network } from "hardhat";
import { DynamicLPStrategy } from "../typechain";

const DEGENBOX = "0xD825d06061fdc0585e4373F0A3F01a8C02b0e6A4";
const JOE_USDCe_WAVAX_LP = "0xA389f9430876455C36478DeEa9769B7Ca4E3DDB1";
const PNG_USDCe_WAVAX_LP = "0xbd918Ed441767fe7924e99F6a0E0B568ac1970D9";
//11905974

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const DynamicLPStrategyName = "Popsicle_UsdceWavaxJLP_DynamicLPStrategy";

  await deploy(DynamicLPStrategyName, {
    from: deployer,
    args: [
      JOE_USDCe_WAVAX_LP, // strategy token
      DEGENBOX,
      deployer
    ],
    log: true,
    deterministicDeployment: false,
  })

  const DynamicLPStrategy = await ethers.getContract<DynamicLPStrategy>(DynamicLPStrategyName);

  // USDC.e/WAVAX jPL sub-strategy
  await deploy("DynamicSubLPStrategy", {
    from: deployer,
    args: [
      DEGENBOX,
      DynamicLPStrategy.address,
      JOE_USDCe_WAVAX_LP,
      JOE_USDCe_WAVAX_LP,
      "0x0E1eA2269D6e22DfEEbce7b0A4c6c3d415b5bC85", // USDC.e/WAVAX jLP oracle
      "0xd6a4F121CA35509aF06A0Be99093d08462f53052", // Joe MasterChefV2
      "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", // Joe Token
      39, // MasterChefV2 AVAX/USDC pool id
      false, // _usePairToken0 to false, JOE -> WAVAX -> jLP (USDC.e/WAVAX)

      // _strategyTokenInInfo
      {
        factory: "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10", // Joe Factory
        router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // Joe Router
        pairCodeHash: "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91" // pair hash code for TraderJoe
      },
      // _strategyTokenOutInfo - Same as _strategyTokenInInfo since token in is same as tokenOut
      {
        factory: "0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10", // Joe Factory
        router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", // Joe Router
        pairCodeHash: "0x0bbca9af0511ad1a1da383135cf3a8d2ac620e549ef9f6ae3a4c33c2fed0af91" // pair hash code for TraderJoe
      }
    ],
    log: true,
    deterministicDeployment: false,
  })

};

export default deployFunction;

if(network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "43114");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["PopsicleUsdcAvaxDynamicStrategy"];
deployFunction.dependencies = [];
