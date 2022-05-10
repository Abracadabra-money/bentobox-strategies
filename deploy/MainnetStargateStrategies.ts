import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network } from "hardhat";
import { wrappedDeploy } from "../utilities";
import { Constants, xMerlin } from "../test/constants";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const MainnetUsdcStargateLPStrategy = await wrappedDeploy("MainnetUsdcStargateLPStrategy", {
    from: deployer,
    args: [
      Constants.mainnet.stargate.usdcPool,
      Constants.mainnet.degenBox,
      Constants.mainnet.stargate.router,
      Constants.mainnet.stargate.usdcPoolId,
      Constants.mainnet.stargate.staking,
      Constants.mainnet.stargate.usdcStakingPid,
    ],
    log: true,
    deterministicDeployment: false,
  });

  const MainnetUsdtStargateLPStrategy = await wrappedDeploy("MainnetUsdtStargateLPStrategy", {
    from: deployer,
    args: [
      Constants.mainnet.stargate.usdtPool,
      Constants.mainnet.degenBox,
      Constants.mainnet.stargate.router,
      Constants.mainnet.stargate.usdtPoolId,
      Constants.mainnet.stargate.staking,
      Constants.mainnet.stargate.usdtStakingPid,
    ],
    log: true,
    deterministicDeployment: false,
  });

  if (network.name !== "hardhat") {
    if ((await MainnetUsdcStargateLPStrategy.owner()) != xMerlin) {
      await (await MainnetUsdcStargateLPStrategy.setStrategyExecutor(xMerlin)).wait();
      await (await MainnetUsdcStargateLPStrategy.transferOwnership(xMerlin)).wait();
    }
    if ((await MainnetUsdtStargateLPStrategy.owner()) != xMerlin) {
      await (await MainnetUsdtStargateLPStrategy.setStrategyExecutor(xMerlin)).wait();
      await (await MainnetUsdtStargateLPStrategy.transferOwnership(xMerlin)).wait();
    }
  } else {
    await (await MainnetUsdcStargateLPStrategy.setStrategyExecutor(deployer, true)).wait();
    await (await MainnetUsdtStargateLPStrategy.setStrategyExecutor(deployer, true)).wait();
  }
};

export default deployFunction;

if (network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "1");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["MainnetStargateStrategies"];
deployFunction.dependencies = [];
