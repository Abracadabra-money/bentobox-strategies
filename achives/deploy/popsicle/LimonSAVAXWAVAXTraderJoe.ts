import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { network, ethers } from "hardhat";
import { MasterChefLPStrategy } from "../typechain";
import { wrappedDeploy } from "../utilities";
import { Constants, xMerlin } from "../test/constants";

const deployFunction: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { getNamedAccounts } = hre;
  const { deployer } = await getNamedAccounts();

  const PopsicleWAvaxSavaxTraderJoeStrategy = await wrappedDeploy<MasterChefLPStrategy>("PopsicleWAvaxSavaxTraderJoeStrategy", {
    from: deployer,
    args: [
      Constants.avalanche.traderjoe.savaxWavax,
      Constants.avalanche.limone,
      Constants.avalanche.traderjoe.factory,
      network.name === "hardhat" ? deployer : xMerlin,
      Constants.avalanche.traderjoe.masterChefV3,
      Constants.avalanche.traderjoe.savaxWavaxPid,
      Constants.avalanche.traderjoe.router,
      Constants.avalanche.traderjoe.pairHashCode,
    ],
    log: true,
    deterministicDeployment: false,
    contract: "MasterChefLPStrategy",
  });

  // Support for swapping JOE rewards to AVAX -> sAVAX/wAVAX LP
  await (
    await PopsicleWAvaxSavaxTraderJoeStrategy.setRewardTokenInfo(Constants.avalanche.joe, ethers.constants.AddressZero, false, true)
  ).wait();

  // Support for swapping QI rewards to AVAX -> sAVAX/wAVAX LP
  await (await PopsicleWAvaxSavaxTraderJoeStrategy.setRewardTokenInfo(Constants.avalanche.qi, ethers.constants.AddressZero, false, true)).wait();

  if (network.name !== "hardhat") {
    if ((await PopsicleWAvaxSavaxTraderJoeStrategy.feeCollector()) != xMerlin) {
      await (await PopsicleWAvaxSavaxTraderJoeStrategy.setFeeParameters(xMerlin, 10)).wait();
    }
    if ((await PopsicleWAvaxSavaxTraderJoeStrategy.owner()) != xMerlin) {
      await (await PopsicleWAvaxSavaxTraderJoeStrategy.transferOwnership(xMerlin)).wait();
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
          resolve(chainId !== "43114");
        });
      } catch (error) {
        reject(error);
      }
    });
}

deployFunction.tags = ["LimonSAVAXWAVAXTraderJoe"];
deployFunction.dependencies = [];
