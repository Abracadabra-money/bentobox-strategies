import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network } from "hardhat";
import { Constants, xMerlin } from "../test/constants";
import { ChainId, setDeploymentSupportedChains, wrappedDeploy } from "../utilities";
import { VelodromeGaugeLPStrategy } from "../typechain";

export const ParametersPerChain = {
  [ChainId.Optimism]: {},
};

const deployFunction: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  const executor = deployer;
  const usePairToken0 = false; // Swap Velo rewards to USDC to provide vOP/USDC liquidity

  const Strategy = await wrappedDeploy<VelodromeGaugeLPStrategy>("LimoneVelodromeVolatileOpUsdcStrategy", {
    from: deployer,
    args: [
      Constants.optimism.velodrome.vOpUsdc,
      Constants.optimism.limone,
      Constants.optimism.velodrome.factory,
      executor,
      Constants.optimism.velodrome.vOpUsdcGauge,
      false, // Volatile Pool
      Constants.optimism.velodrome.velo,
      usePairToken0
    ],
    log: true,
    deterministicDeployment: false,
    contract: "VelodromeGaugeLPStrategy"
  })

  if (network.name !== "hardhat") {
    await (await Strategy.setStrategyExecutor(deployer, false)).wait();
    await (await Strategy.setStrategyExecutor(xMerlin, true)).wait();
    await (await Strategy.transferOwnership(xMerlin)).wait();
    await (await Strategy.setFeeParameters(xMerlin, 10)).wait();
  }
};

export default deployFunction;

setDeploymentSupportedChains(Object.keys(ParametersPerChain), deployFunction);

deployFunction.tags = ["LimoneVelodromeVolatileOpUsdcStrategy"];
deployFunction.dependencies = [];
