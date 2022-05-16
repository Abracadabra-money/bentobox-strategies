import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network } from "hardhat";
import { ChainId, wrappedDeploy } from "../utilities";
import { Constants, xMerlin } from "../test/constants";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const chainId = parseInt(await hre.getChainId());
  let UsdcStargateLPStrategy;
  let UsdtStargateLPStrategy;

  switch (chainId) {
    case ChainId.Mainnet:
      UsdcStargateLPStrategy = await wrappedDeploy("MainnetUsdcStargateLPStrategy", {
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

      UsdtStargateLPStrategy = await wrappedDeploy("MainnetUsdtStargateLPStrategy", {
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
      break;
    case ChainId.Arbitrum:
      UsdcStargateLPStrategy = await wrappedDeploy("ArbitrumUsdcStargateLPStrategy", {
        from: deployer,
        args: [
          Constants.arbitrum.stargate.usdcPool,
          Constants.arbitrum.degenBox,
          Constants.arbitrum.stargate.router,
          Constants.arbitrum.stargate.usdcPoolId,
          Constants.arbitrum.stargate.staking,
          Constants.arbitrum.stargate.usdcStakingPid,
        ],
        log: true,
        deterministicDeployment: false,
      });

      UsdtStargateLPStrategy = await wrappedDeploy("ArbitrumUsdtStargateLPStrategy", {
        from: deployer,
        args: [
          Constants.arbitrum.stargate.usdtPool,
          Constants.arbitrum.degenBox,
          Constants.arbitrum.stargate.router,
          Constants.arbitrum.stargate.usdtPoolId,
          Constants.arbitrum.stargate.staking,
          Constants.arbitrum.stargate.usdtStakingPid,
        ],
        log: true,
        deterministicDeployment: false,
      });
      break;
  }

  if (network.name !== "hardhat") {
    if ((await UsdcStargateLPStrategy.owner()) != xMerlin) {
      await (await UsdcStargateLPStrategy.setFeeParameters(xMerlin, 10)).wait();
      await (await UsdcStargateLPStrategy.setStrategyExecutor(xMerlin, true)).wait();
      await (await UsdcStargateLPStrategy.transferOwnership(xMerlin)).wait();
    }
    if ((await UsdtStargateLPStrategy.owner()) != xMerlin) {
      await (await UsdtStargateLPStrategy.setFeeParameters(xMerlin, 10)).wait();
      await (await UsdtStargateLPStrategy.setStrategyExecutor(xMerlin, true)).wait();
      await (await UsdtStargateLPStrategy.transferOwnership(xMerlin)).wait();
    }
  } else {
    await (await UsdcStargateLPStrategy.setStrategyExecutor(deployer, true)).wait();
    await (await UsdtStargateLPStrategy.setStrategyExecutor(deployer, true)).wait();
  }
};

export default deployFunction;

if (network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "42161");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["StargateStrategies"];
deployFunction.dependencies = [];
