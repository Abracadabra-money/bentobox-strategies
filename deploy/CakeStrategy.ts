import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";
import { CakeStrategy } from "../typechain";
import { wrappedDeploy } from "../utilities";
import { xMerlin } from "../test/constants";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  const strategyToken = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"; // CAKE
  const degenBox = "0x090185f2135308bad17527004364ebcc2d37e5f6";
  const factory = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73"; // Cake Factory
  const bridgeToken = ethers.constants.AddressZero;
  const masterChef = "0x45c54210128a065de780C4B0Df3d16664f7f859e"; // CakePool (New Staking Contract)
  const pairHashCode = "0x00fb7f630766e6a796048ea87d01acd3068e8ff67d078148a3fa3f4a84f69bd5"; // pair hash code for Pancake

  const CakeStrategy = await wrappedDeploy<CakeStrategy>("CakeStrategyV2", {
    from: deployer,
    args: [
      strategyToken,
      degenBox,
      factory,
      bridgeToken,
      network.name === "hardhat" ? deployer : xMerlin,
      masterChef,
      pairHashCode,
    ],
    log: true,
    deterministicDeployment: false
  });

  if (network.name !== "hardhat") {
    if ((await CakeStrategy.feeCollector()) != xMerlin) {
      await (await CakeStrategy.setFeeCollector(xMerlin)).wait();
    }
    if ((await CakeStrategy.owner()) != xMerlin) {
      await (await CakeStrategy.transferOwnership(xMerlin)).wait();
    }
  }
};

export default deployFunction;

// Deploy on Avalanche only
if (network.name !== "hardhat") {
  deployFunction.skip = ({ getChainId }) =>
    new Promise((resolve, reject) => {
      try {
        getChainId().then((chainId) => {
          resolve(chainId !== "56");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["CakeStrategy"];
deployFunction.dependencies = [];
