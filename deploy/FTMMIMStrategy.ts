import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";
import { Constants } from "../test/constants";

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  const executor = deployer;
  const usePairToken0 = true; // Swap Spirit rewards to FTM to provide FTM/MIM liquidity

  await deploy("FTMMIMSpiritSwapLPStrategy", {
    from: deployer,
    args: [
      Constants.fantom.spiritFtmMimPair,
      Constants.fantom.degenBox,
      Constants.fantom.spiritFactory,
      executor,
      Constants.fantom.spiritFtmMimGauge,
      Constants.fantom.spîrit,
      usePairToken0
    ],
    log: true,
    deterministicDeployment: false,
    contract: "SpiritSwapLPStrategy"
  })
};

export default deployFunction;

// Deploy on Avalanche only
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

deployFunction.tags = ["FTMMIMSpiritSwapLPStrategy"];
deployFunction.dependencies = [];
