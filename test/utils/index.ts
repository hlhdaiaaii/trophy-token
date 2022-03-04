import hre, { ethers } from "hardhat";

export const impersonate = async (address: string) => {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [address],
  });

  const signer = await ethers.getSigner(address);

  return {
    signer,
    stopImpersonateCb: async () => {
      await hre.network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [address],
      });
    },
  };
};

export const moveToTime = async (timestamp: number) => {
  await ethers.provider.send("evm_mine", [timestamp]);
};

export const mineBlocks = async (n: number) => {
  return hre.network.provider.send("hardhat_mine", [
    ethers.utils.hexStripZeros(n as any),
  ]);
};

export const setByteCode = async (address: string, byteCode: string) => {
  await hre.network.provider.send("hardhat_setCode", [address, byteCode]);
};

export const getByteCode = async (address: string) => {
  const code = await hre.network.provider.send("eth_getCode", [address]);
  return code;
};

export const parseUnits = (value: string | number, decimals: number = 18) => {
  return ethers.utils.parseUnits(value.toString(), decimals);
};

export const formatUnits = (value: string | number, decimals: number = 18) => {
  return ethers.utils.formatUnits(value.toString(), decimals);
};