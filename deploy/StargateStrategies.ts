import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network } from "hardhat";
import { ChainId, setDeploymentSupportedChains, wrappedDeploy } from "../utilities";
import { Constants, xMerlin } from "../test/constants";
import { StargateLPStrategy } from "../typechain";

export const ParametersPerChain = {
  [ChainId.Mainnet]: {},
  [ChainId.Arbitrum]: {},
  [ChainId.Avalanche]: {},
};

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const chainId = parseInt(await hre.getChainId());
  let UsdcStargateLPStrategy: StargateLPStrategy;
  let UsdtStargateLPStrategy: StargateLPStrategy;
  let UsdcSwapper;
  let UsdtSwapper;

  switch (chainId) {
    case ChainId.Arbitrum:
      UsdcStargateLPStrategy = await wrappedDeploy<StargateLPStrategy>("ArbitrumUsdcStargateLPStrategyV1", {
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
        contract: "StargateLPStrategy",
      });

      UsdtStargateLPStrategy = await wrappedDeploy<StargateLPStrategy>("ArbitrumUsdtStargateLPStrategyV1", {
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
        contract: "StargateLPStrategy",
      });

      UsdcSwapper = await wrappedDeploy("ArbitrumStargateUsdcSwapperV1", {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: false,
      });
      UsdtSwapper = await wrappedDeploy("ArbitrumStargateUsdtSwapperV1", {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: false,
      });
      break;

    case ChainId.Avalanche:
      UsdcStargateLPStrategy = await wrappedDeploy<StargateLPStrategy>("AvalancheUsdcStargateLPStrategyV1", {
        from: deployer,
        args: [
          Constants.avalanche.stargate.usdcPool,
          Constants.avalanche.degenBox,
          Constants.avalanche.stargate.router,
          Constants.avalanche.stargate.usdcPoolId,
          Constants.avalanche.stargate.staking,
          Constants.avalanche.stargate.usdcStakingPid,
        ],
        log: true,
        deterministicDeployment: false,
        contract: "StargateLPStrategy",
      });

      UsdtStargateLPStrategy = await wrappedDeploy<StargateLPStrategy>("AvalancheUsdcStargateLPStrategyV1", {
        from: deployer,
        args: [
          Constants.avalanche.stargate.usdtPool,
          Constants.avalanche.degenBox,
          Constants.avalanche.stargate.router,
          Constants.avalanche.stargate.usdtPoolId,
          Constants.avalanche.stargate.staking,
          Constants.avalanche.stargate.usdtStakingPid,
        ],
        log: true,
        deterministicDeployment: false,
        contract: "StargateLPStrategy",
      });

      UsdcSwapper = await wrappedDeploy("AvalancheStargateUsdcSwapperV1", {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: false,
      });
      UsdtSwapper = await wrappedDeploy("AvalancheStargateUsdtSwapperV1", {
        from: deployer,
        args: [],
        log: true,
        deterministicDeployment: false,
      });
      break;
    default:
      throw new Error("Unsupported chain");
  }

  await (await UsdcStargateLPStrategy.setStargateSwapper(UsdcSwapper.address)).wait();
  await (await UsdtStargateLPStrategy.setStargateSwapper(UsdtSwapper.address)).wait();

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

setDeploymentSupportedChains(Object.keys(ParametersPerChain), deployFunction);

deployFunction.tags = ["StargateStrategies"];
deployFunction.dependencies = [];
