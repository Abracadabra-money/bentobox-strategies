import { ParamType } from "@ethersproject/abi";
import { BigNumber, Contract } from "ethers";
import { DeployFunction, DeployOptions } from "hardhat-deploy/types";
import hre, { deployments, ethers, network } from "hardhat";
import { BentoBoxV1 } from "../typechain";

export const BASE_TEN = 10;

export function encodeParameters(types: readonly (string | ParamType)[], values: readonly any[]) {
  const abi = new ethers.utils.AbiCoder();
  return abi.encode(types, values);
}

export const impersonate = async (address: string) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });
};

// Defaults to e18 using amount * 10^18
export function getBigNumber(amount: any, decimals = 18) {
  return BigNumber.from(amount).mul(BigNumber.from(BASE_TEN).pow(decimals));
}

export async function wrappedDeploy<T extends Contract>(name: string, options: DeployOptions): Promise<T> {
  await hre.deployments.deploy(name, options);

  const contract = await ethers.getContract<T>(name);
  await verifyContract(name, contract.address, options.args || []);

  return contract;
}

export async function verifyContract(name: string, address: string, constructorArguments: string[]) {
  if (network.name !== "hardhat") {
    process.stdout.write(`Verifying ${name}...`);
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments,
      });
      console.log("[OK]");
    } catch (e: any) {
      console.log(`[FAILED] ${e.message}`);
    }
  }
}

export enum ChainId {
  Mainnet = 1,
  Ropsten = 3,
  Rinkeby = 4,
  Goerli = 5,
  Kovan = 42,
  BSC = 56,
  BSCTestnet = 97,
  xDai = 100,
  Polygon = 137,
  Theta = 361,
  ThetaTestnet = 365,
  Moonriver = 1285,
  Mumbai = 80001,
  Harmony = 1666600000,
  Palm = 11297108109,
  Localhost = 1337,
  Hardhat = 31337,
  Fantom = 250,
  Arbitrum = 42161,
  Avalanche = 43114,
  Boba = 288,
}

export const setDeploymentSupportedChains = (supportedChains: string[], deployFunction: DeployFunction) => {
  if (network.name !== "hardhat" || process.env.HARDHAT_LOCAL_NODE) {
    deployFunction.skip = ({ getChainId }) =>
      new Promise(async (resolve, reject) => {
        try {
          getChainId().then((chainId) => {
            resolve(supportedChains.indexOf(chainId.toString()) === -1);
          });
        } catch (error) {
          reject(error);
        }
      });
  }
};

export async function deployCauldron<T extends Contract>(
  deploymentName: string,
  bentoBox: string,
  masterContract: string,
  collateral: string,
  oracle: string,
  oracleData: string,
  ltv: number,
  interest: number,
  borrowFee: number,
  liquidationFee: number
): Promise<T> {
  console.log(`Deploying cauldron ${deploymentName}...`);

  try {
    const existingDeployment = await ethers.getContract<T>(deploymentName);
    console.log(`Already deployment at ${existingDeployment.address}`);
    return existingDeployment;
  } catch {}

  console.table({
    MasterContract: masterContract,
    Collateral: collateral,
    LTV: `${ltv}%`,
    Interests: `${interest}%`,
    "Borrow Fee": `${borrowFee}%`,
    "Liquidation Fee": `${liquidationFee}%`,
    Oracle: oracle,
    "Oracle Data": oracleData,
  });

  const INTEREST_CONVERSION = 1e18 / (365.25 * 3600 * 24) / 100;
  const OPENING_CONVERSION = 1e5 / 100;

  ltv = ltv * 1e3; // LTV
  borrowFee = borrowFee * OPENING_CONVERSION; // borrow initial fee
  interest = parseInt(String(interest * INTEREST_CONVERSION)); // Interest
  liquidationFee = liquidationFee * 1e3 + 1e5; // liquidation fee

  let initData = ethers.utils.defaultAbiCoder.encode(
    ["address", "address", "bytes", "uint64", "uint256", "uint256", "uint256"],
    [collateral, oracle, oracleData, interest, liquidationFee, ltv, borrowFee]
  );

  const BentoBox = await ethers.getContractAt<BentoBoxV1>("BentoBoxV1", bentoBox);
  const tx = await (await BentoBox.deploy(masterContract, initData, true)).wait();

  const deployEvent = tx?.events?.[0];
  if (deployEvent?.eventSignature !== "LogDeploy(address,bytes,address)") {
    throw new Error("Error while deploying cauldron, unexpected eventSignature returned");
  }

  const address = deployEvent?.args?.cloneAddress;

  // Register the deployment so it's available within the test using `getContract`
  deployments.save(deploymentName, {
    abi: [],
    address,
  });

  console.log(`${deploymentName} deployed at ${address}`);

  return ethers.getContract<T>(deploymentName);
}

export * from "./time";
