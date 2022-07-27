import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, network } from "hardhat";
import { Constants, xMerlin } from "../test/constants";
import { wrappedDeploy } from "../utilities";
import { MasterChefLPStrategy } from "../typechain";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  const executor = deployer;

  const Strategy = await wrappedDeploy<MasterChefLPStrategy>("FUSDTUSDCSpiritSwapLPStrategy", {
    from: deployer,
    args: [
      Constants.fantom.spiritswap.fUSDTUSDC,
      Constants.fantom.limone,
      Constants.fantom.spiritswap.factory,
      Constants.fantom.wftm,
      executor,
      Constants.fantom.spiritswap.staking,
      65,
      Constants.fantom.spiritswap.router,
      Constants.fantom.spiritswap.spîrit,
      true,
      Constants.fantom.spiritswap.initHash,
    ],
    log: true,
    deterministicDeployment: false,
    contract: "MasterChefLPStrategy",
  });

  if (network.name !== "hardhat") {
    await (await Strategy.setStrategyExecutor(deployer, false)).wait();
    await (await Strategy.setStrategyExecutor(xMerlin, true)).wait();
    await (await Strategy.setFeeParameters(xMerlin, 10)).wait();
    await (await Strategy.transferOwnership(xMerlin)).wait();
  }
};

export default deployFunction;

// Deploy on Avalanche only
if (network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "250");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["LimoneSpiritFUSDTUSDCStrategy"];
deployFunction.dependencies = [];
