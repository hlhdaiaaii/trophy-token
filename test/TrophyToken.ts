import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import PancakeFactoryABI from "../abi/PancakeFactory.json";
import PancakePairABI from "../abi/PancakePair.json";
import RouterABI from "../abi/Router.json";
import WrappedBNBABI from "../abi/WrappedBNB.json";
import { TrophyToken__factory } from "../types/factories/TrophyToken__factory";
import { MockBUSD } from "../types/MockBUSD";
import { PancakeFactory } from "../types/PancakeFactory";
import { PancakePair } from "../types/PancakePair";
import { Router } from "../types/Router";
import { TrophyToken } from "../types/TrophyToken";
import { WrappedBNB } from "../types/WrappedBNB";
import { parseUnits } from "./utils";

chai.use(solidity);
const { assert } = chai;

describe("TrophyTokenV2", async () => {
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let lpTo: SignerWithAddress;
  let mkt: SignerWithAddress;
  let dev: SignerWithAddress;
  let router: Router;
  let pancakeFactory: PancakeFactory;
  let trophyToken: TrophyToken;
  let mockBUSD: MockBUSD;
  let wrappedBNB: WrappedBNB;
  let pair: PancakePair;
  let now: number;

  const ROUTER_ADDRESS = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
  const PANCAKE_FACTORY_ADDRESS = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
  const WRAPPED_BNB_ADDRESS = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
  const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";

  before(async () => {
    [admin, user1, user2, lpTo, mkt, dev] = await ethers.getSigners();
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 40 ~ before ~ admin",
      admin.address
    );
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 40 ~ before ~ user1",
      user1.address
    );
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 40 ~ before ~ user2",
      user2.address
    );
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 44 ~ before ~ dev",
      dev.address
    );
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 44 ~ before ~ mkt",
      mkt.address
    );

    const currentBlock = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber()
    );

    now = currentBlock.timestamp;

    router = <Router>await ethers.getContractAt(RouterABI, ROUTER_ADDRESS);
    pancakeFactory = <PancakeFactory>(
      await ethers.getContractAt(PancakeFactoryABI, PANCAKE_FACTORY_ADDRESS)
    );
    wrappedBNB = <WrappedBNB>(
      await ethers.getContractAt(WrappedBNBABI, WRAPPED_BNB_ADDRESS)
    );

    const trophyTokenFactory = <TrophyToken__factory>(
      await ethers.getContractFactory("TrophyToken")
    );
    trophyToken = await trophyTokenFactory
      .connect(admin)
      .deploy(
        router.address,
        lpTo.address,
        1000,
        1000,
        BURN_ADDRESS,
        [mkt.address, dev.address],
        [2000, 2000]
      );
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 80 ~ before ~ trophyToken",
      trophyToken.address
    );

    const feeToList0 = await trophyToken.feeToList(0);
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 91 ~ before ~ feeToList0",
      feeToList0
    );
    const feeToList1 = await trophyToken.feeToList(1);
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 93 ~ before ~ feeToList1",
      feeToList1
    );

    const bnbLiqAmount = parseUnits(700);
    const tokenLiqAmount = bnbLiqAmount.mul(100000);

    await trophyToken.connect(admin).mint(admin.address, tokenLiqAmount);
    // await mockBUSD.connect(admin).mint(admin.address, busdLiqAmount);

    // allocate bnb for token contract
    // await admin.sendTransaction({
    //   to: trophyToken.address,
    //   value: parseUnits(1),
    // });

    // const cakeToken = <PancakePair>(
    //   await ethers.getContractAt(
    //     PancakePairABI,
    //     "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82"
    //   )
    // );
    // const cakeBurnAmount = await cakeToken.balanceOf(
    //   "0x000000000000000000000000000000000000dead"
    // );
    // console.log(
    //   "🚀 ~ file: TrophyTokenV2.ts ~ line 107 ~ before ~ cakeBurnAmount",
    //   cakeBurnAmount
    // );

    // approve router
    await trophyToken
      .connect(admin)
      .approve(router.address, ethers.constants.MaxUint256);
    await trophyToken
      .connect(user1)
      .approve(router.address, ethers.constants.MaxUint256);
    await trophyToken
      .connect(user2)
      .approve(router.address, ethers.constants.MaxUint256);

    // add liquidity eth 1BNB = 100000 TRT
    await router
      .connect(admin)
      .addLiquidityETH(
        trophyToken.address,
        tokenLiqAmount,
        tokenLiqAmount,
        bnbLiqAmount,
        admin.address,
        now + 60000,
        {
          value: bnbLiqAmount,
        }
      );

    pair = <PancakePair>(
      await ethers.getContractAt(PancakePairABI, await trophyToken.pair())
    );
    console.log(
      "🚀 ~ file: TrophyTokenV2.ts ~ line 113 ~ before ~ pair",
      pair.address
    );
  });

  describe("Swap", async () => {
    it("should let user buy without fee", async () => {
      const path = [wrappedBNB.address, trophyToken.address];

      // const amountOutMin = parseUnits(1000);

      await router
        .connect(user1)
        .swapExactETHForTokens(0, path, user1.address, now + 60000, {
          value: parseUnits(5),
        });

      const user1TokenBalance = await trophyToken.balanceOf(user1.address);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 139 ~ it ~ user1TokenBalance",
        user1TokenBalance
      );
    });

    it("should let user sell with fee", async () => {
      // const feeToListBF = await trophyToken.getFeeToList();
      // console.log(
      //   "🚀 ~ file: TrophyTokenV2.ts ~ line 193 ~ it ~ feeToListBF",
      //   feeToListBF
      // );
      // await trophyToken.connect(admin).removeFeeTo(mkt.address);

      // const feeToListAT = await trophyToken.getFeeToList();
      // console.log(
      //   "🚀 ~ file: TrophyTokenV2.ts ~ line 193 ~ it ~ feeToListAT",
      //   feeToListAT
      // );

      const path = [trophyToken.address, wrappedBNB.address];
      const amountIn = parseUnits(100000);

      const amountOut = await router.getAmountsOut(amountIn, path);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 151 ~ it ~ amountOut",
        amountOut
      );
      const amountOutMin = amountOut[1].sub(amountOut[1].mul(7).div(100));
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 180 ~ it ~ amountOutMin",
        amountOutMin
      );

      const trophyBNBBF = await trophyToken.getEthBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 148 ~ it ~ trophyBNBBF",
        trophyBNBBF
      );

      const trophyTokenBalanceBF = await trophyToken.balanceOf(
        trophyToken.address
      );
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 148 ~ it ~ trophyTokenBalanceBF",
        trophyTokenBalanceBF
      );

      const adminBNBBF = await admin.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 148 ~ it ~ adminBNBBF",
        adminBNBBF
      );

      const mktBNBBF = await mkt.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 164 ~ it ~ mktBNBBF",
        mktBNBBF
      );

      const devBNBBF = await dev.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 164 ~ it ~ devBNBBF",
        devBNBBF
      );

      const burnBF = await trophyToken.balanceOf(BURN_ADDRESS);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 162 ~ it ~ burnBF",
        burnBF
      );

      const lpBF = await pair.balanceOf(lpTo.address);
      console.log("🚀 ~ file: TrophyTokenV2.ts ~ line 187 ~ it ~ lpBF", lpBF);

      const user1TokenBalanceBF = await trophyToken.balanceOf(user1.address);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 162 ~ it ~ user1TokenBalanceBF",
        user1TokenBalanceBF
      );
      const user1BNBBF = await user1.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 168 ~ it ~ user1BNBBF",
        user1BNBBF
      );

      await router
        .connect(user1)
        .swapExactTokensForETHSupportingFeeOnTransferTokens(
          amountIn,
          amountOutMin,
          path,
          user1.address,
          now + 60000
        );

      // await moveToTime(now + 60000);

      const trophyBNBAT = await trophyToken.getEthBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 148 ~ it ~ trophyBNBAT",
        trophyBNBAT
      );

      const trophyTokenBalanceAT = await trophyToken.balanceOf(
        trophyToken.address
      );
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 148 ~ it ~ trophyTokenBalanceAT",
        trophyTokenBalanceAT
      );

      const adminBNBAT = await admin.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 164 ~ it ~ adminBNBAT",
        adminBNBAT
      );

      const mktBNBAT = await mkt.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 164 ~ it ~ mktBNBAT",
        mktBNBAT
      );

      const devBNBAT = await dev.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 164 ~ it ~ devBNBAT",
        devBNBAT
      );

      const burnAT = await trophyToken.balanceOf(BURN_ADDRESS);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 162 ~ it ~ burnAT",
        burnAT
      );

      const lpAT = await pair.balanceOf(lpTo.address);
      console.log("🚀 ~ file: TrophyTokenV2.ts ~ line 187 ~ it ~ lpAT", lpAT);

      const user1TokenBalanceAT = await trophyToken.balanceOf(user1.address);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 162 ~ it ~ user1TokenBalanceAT",
        user1TokenBalanceAT
      );
      const user1BNBAT = await user1.getBalance();
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 168 ~ it ~ user1BNBAT",
        user1BNBAT
      );

      // collect dust
      const user2TokenBalanceBF = await trophyToken.balanceOf(user2.address);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 348 ~ it ~ user2TokenBalanceBF",
        user2TokenBalanceBF
      );
      await trophyToken
        .connect(admin)
        .collectTokenDust(trophyToken.address, user2.address);

      const user2TokenBalanceAT = await trophyToken.balanceOf(user2.address);
      console.log(
        "🚀 ~ file: TrophyTokenV2.ts ~ line 348 ~ it ~ user2TokenBalanceAT",
        user2TokenBalanceAT
      );
    });
  });
});
