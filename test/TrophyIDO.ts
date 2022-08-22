import chai, { expect } from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import { Router } from "../types/Router";
import RouterABI from "../abi/Router.json";
import { PancakeFactory } from "../types/PancakeFactory";
import PancakeFactoryABI from "../abi/PancakeFactory.json";
import { PancakePair } from "../types/PancakePair";
import PancakePairABI from "../abi/PancakePair.json";
import { TrophyToken__factory } from "../types/factories/TrophyToken__factory";
import { TrophyToken } from "../types/TrophyToken";
import { TrophyIDO__factory } from "../types/factories/TrophyIDO__factory";
import { TrophyIDO } from "../types/TrophyIDO";
import { MockBUSD__factory } from "../types/factories/MockBUSD__factory";
import { MockBUSD } from "../types/MockBUSD";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { moveToTime, parseUnits } from "./utils";

chai.use(solidity);
const { assert } = chai;

describe("TrophyIDO", async function () {
  let admin: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let lpTo: SignerWithAddress;
  let mkt: SignerWithAddress;
  let dev: SignerWithAddress;
  let router: Router;
  let pancakeFactory: PancakeFactory;
  let trophyToken: TrophyToken;
  let trophyIDO: TrophyIDO;
  let mockBUSD: MockBUSD;
  let pair: PancakePair;
  let now: number;

  const ROUTER_ADDRESS = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
  const PANCAKE_FACTORY_ADDRESS = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";
  const PRICE = parseUnits(0.00004);
  const LISTING_PRICE = parseUnits(0.00006);
  const MIN_PURCHASE = parseUnits(0.2);
  const MAX_PURCHASE = parseUnits(1);
  const HARD_CAP = parseUnits(1000); // 1000 BNB
  const LP_PERCENT = 600; // 600/1000 = 60%
  const ONE_DAY_IN_SECONDS = 86400;
  const BURN_ADDRESS = "0x000000000000000000000000000000000000dead";
  const ONE_ETH = parseUnits(1);

  before(async () => {
    [admin, user1, user2, lpTo, mkt, dev] = await ethers.getSigners();

    const currentBlock = await ethers.provider.getBlock(
      await ethers.provider.getBlockNumber()
    );
    now = currentBlock.timestamp;

    router = <Router>await ethers.getContractAt(RouterABI, ROUTER_ADDRESS);
    pancakeFactory = <PancakeFactory>(
      await ethers.getContractAt(PancakeFactoryABI, PANCAKE_FACTORY_ADDRESS)
    );

    const mockBUSDFactory = <MockBUSD__factory>(
      await ethers.getContractFactory("MockBUSD")
    );
    mockBUSD = await mockBUSDFactory.connect(admin).deploy();

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

    // pair = <PancakePair>(
    //   await ethers.getContractAt(PancakePairABI, await trophyToken.pair())
    // );
    pair = <PancakePair>(
      await ethers.getContractAt(
        PancakePairABI,
        await pancakeFactory.getPair(trophyToken.address, await router.WETH())
      )
    );

    const trophyIDOFactory = <TrophyIDO__factory>(
      await ethers.getContractFactory("TrophyIDO")
    );
    trophyIDO = <TrophyIDO>(
      await trophyIDOFactory
        .connect(admin)
        .deploy(
          trophyToken.address,
          PRICE,
          LISTING_PRICE,
          MIN_PURCHASE,
          MAX_PURCHASE,
          HARD_CAP,
          now + ONE_DAY_IN_SECONDS,
          now + ONE_DAY_IN_SECONDS * 2,
          LP_PERCENT,
          router.address
        )
    );

    // excluded ido contract from fee
    await trophyToken.connect(admin).addExcludedFromFee(trophyIDO.address);

    // allocate mock busd
    // mockBUSD
    //   .connect(admin)
    //   .mint(user1.address, ethers.utils.parseEther("1000"));
    // mockBUSD
    //   .connect(admin)
    //   .mint(user2.address, ethers.utils.parseEther("1000"));

    // approve MockBUSD for TrophyIDO
    // mockBUSD
    //   .connect(user1)
    //   .approve(trophyIDO.address, ethers.constants.MaxUint256);
    // mockBUSD
    //   .connect(user2)
    //   .approve(trophyIDO.address, ethers.constants.MaxUint256);
  });

  describe("BUY SALE", async () => {
    it("should not let user buy before start time", async () => {
      await expect(trophyIDO.connect(user1).purchase()).to.revertedWith(
        "NOT_OCCURRING"
      );

      // increase timestamp for next test
      await moveToTime(now + ONE_DAY_IN_SECONDS + 1);
    });

    it("should let user buy sale", async () => {
      // expect(await mockBUSD.balanceOf(trophyIDO.address)).to.eq(
      //   ethers.utils.parseEther((PRICE * 2).toString())
      // );

      const user1PurchaseAmount = parseUnits(1);
      const user2PurchaseAmount = parseUnits(0.4);

      await trophyIDO.connect(user1).purchase({
        value: user1PurchaseAmount,
      });
      await trophyIDO.connect(user2).purchase({
        value: user2PurchaseAmount,
      });

      await expect(
        trophyIDO.connect(user1).purchase({
          value: user1PurchaseAmount,
        })
      ).to.be.revertedWith("ALREADY_PURCHASED");
      await expect(
        trophyIDO.connect(user2).purchase({
          value: user2PurchaseAmount,
        })
      ).to.be.revertedWith("ALREADY_PURCHASED");

      // await expect(async () => {
      //   await trophyIDO.connect(user2).purchase();
      //   await trophyIDO.connect(user2).purchase();
      //   await trophyIDO.connect(user2).purchase();
      // }).to.changeTokenBalance(
      //   mockBUSD,
      //   user2,
      //   ethers.utils.parseEther((PRICE * 3).toString()).mul(-1)
      // );

      const purchasers = await trophyIDO.getAllPurchasers();
      console.log(
        "🚀 ~ file: index.ts ~ line 145 ~ it ~ purchasers",
        purchasers
      );
      expect(purchasers.length).to.eq(2);
    });

    it("should not let user be able to buy if hard cap met", async () => {
      if (HARD_CAP.eq(parseUnits(1))) {
        const purchaseAmount = parseUnits(1);
        await expect(
          trophyIDO.connect(user2).purchase({ value: purchaseAmount })
        ).to.be.revertedWith("MET_HARD_CAP");
      }
    });

    it("should let admin finalize", async () => {
      const currentCap = await trophyIDO.currentCap();
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 186 ~ it ~ currentCap",
        currentCap
      );

      // allocate trophy token
      const totalRequiredToken = await trophyIDO.calcTotalTokensRequired();

      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 101 ~ before ~ totalRequiredToken",
        totalRequiredToken
      );
      await trophyToken
        .connect(admin)
        .mint(trophyIDO.address, totalRequiredToken);

      const adminBNBBF = await admin.getBalance();
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 192 ~ it ~ adminBNBBF",
        adminBNBBF
      );

      const idoTokenBalanceBF = await trophyToken.balanceOf(trophyIDO.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 217 ~ it ~ idoTokenBalanceBF",
        idoTokenBalanceBF
      );

      await trophyIDO.connect(admin).finalize(admin.address);

      const idoTokenBalanceAT = await trophyToken.balanceOf(trophyIDO.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 217 ~ it ~ idoTokenBalanceAT",
        idoTokenBalanceAT
      );

      const reserves = await pair.getReserves();
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 188 ~ it ~ reserves",
        reserves
      );

      const adminBNBAT = await admin.getBalance();
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 192 ~ it ~ adminBNBAT",
        adminBNBAT
      );
    });

    it("should not let admin finalize again", async () => {
      await expect(
        trophyIDO.connect(admin).finalize(admin.address)
      ).to.revertedWith("ALREADY_FINALIZED_OR_CANCELED");
    });

    it("should not let admin cancel after having finalized", async () => {
      await expect(trophyIDO.connect(admin).cancelSale()).revertedWith(
        "ALREADY_CANCELED_OR_FINALIZED"
      );
    });
  });

  describe("USERS CLAIM", async () => {
    it("should let user1 claim", async () => {
      const user1TokenBalanceBF = await trophyToken.balanceOf(user1.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 228 ~ it ~ user1TokenBalanceBF",
        user1TokenBalanceBF
      );
      await trophyIDO.connect(user1).claim();
      const user1TokenBalanceAT = await trophyToken.balanceOf(user1.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 228 ~ it ~ user1TokenBalanceAT",
        user1TokenBalanceAT
      );
    });
    it("should not let user1 claim again", async () => {
      await expect(trophyIDO.connect(user1).claim()).to.revertedWith(
        "INVALID_ACTION"
      );
    });
    it("should let user2 claim", async () => {
      const user2TokenBalanceBF = await trophyToken.balanceOf(user2.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 228 ~ it ~ user2TokenBalanceBF",
        user2TokenBalanceBF
      );
      await trophyIDO.connect(user2).claim();
      const user2TokenBalanceAT = await trophyToken.balanceOf(user2.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 228 ~ it ~ user2TokenBalanceAT",
        user2TokenBalanceAT
      );

      const idoTokenBalanceAT = await trophyToken.balanceOf(trophyIDO.address);
      console.log(
        "🚀 ~ file: TrophyIDO.ts ~ line 217 ~ it ~ idoTokenBalanceAT",
        idoTokenBalanceAT
      );
    });

    // describe("REFUND", async () => {
    //   it("should let admin cancel sale", async () => {
    //     await expect(trophyIDO.connect(admin).cancelSale()).emit(
    //       trophyIDO,
    //       "CanceledSale"
    //     );
    //   });
    //   it("should let user refund", async () => {
    //     const user1BNBBF = await user1.getBalance();
    //     console.log(
    //       "🚀 ~ file: TrophyIDO.ts ~ line 275 ~ it ~ user1BNBBF",
    //       user1BNBBF
    //     );
    //     await trophyIDO.connect(user1).refund();
    //     const user1BNBAT = await user1.getBalance();
    //     console.log(
    //       "🚀 ~ file: TrophyIDO.ts ~ line 275 ~ it ~ user1BNBAT",
    //       user1BNBAT
    //     );
    //   });
    //   it("should not let user refund again", async () => {
    //     await expect(trophyIDO.connect(user1).refund()).to.revertedWith(
    //       "INVALID_ACTION"
    //     );
    //   });
    // });
  });
});
