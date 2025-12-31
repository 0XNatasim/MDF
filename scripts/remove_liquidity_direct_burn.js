const { ethers } = require("hardhat");

const PAIR = "0x7d4A5Ed4C366aFa71c5b4158b2F203B1112AC7FD";
const WMON = "0x51C0bb68b65bd84De6518C939CB9Dbe2d6Fa7079";
const MMM  = "0x1Ad3565c099F5242012Fb1f21aaA729EFcf75c16";

// minimal ABIs
const PAIR_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function burn(address to) returns (uint amount0, uint amount1)"
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)"
];

const WMON_ABI = [
  "function withdraw(uint256 wad) external"
];

async function main() {
  const [signer] = await ethers.getSigners();
  const me = signer.address;

  const pair = new ethers.Contract(PAIR, PAIR_ABI, signer);
  const wmon = new ethers.Contract(WMON, WMON_ABI, signer);

  const lpBal = await pair.balanceOf(me);
  if (lpBal === 0n) throw new Error("You have 0 LP tokens.");

  console.log("Signer:", me);
  console.log("LP balance:", lpBal.toString());

  // OPTIONAL: remove only a portion
  // const pct = 100n; // 100 = 100%
  // const lpToBurn = (lpBal * pct) / 100n;
  const lpToBurn = lpBal; // burn max

  console.log("Transferring LP to pair for burn...");
  const tx1 = await pair.transfer(PAIR, lpToBurn);
  await tx1.wait();

  console.log("Calling pair.burn(me)...");
  const tx2 = await pair.burn(me);
  const rcpt = await tx2.wait();

  // Burn returns (amount0, amount1) but ethers v6 doesn't auto-print it from receipt.
  // So we just show post balances.
  const wmonBal = await (new ethers.Contract(WMON, ERC20_ABI, signer)).balanceOf(me);
  const mmmBal  = await (new ethers.Contract(MMM,  ERC20_ABI, signer)).balanceOf(me);

  console.log("✅ Removed liquidity.");
  console.log("WMON received:", ethers.formatEther(wmonBal));
  console.log("MMM received:", ethers.formatUnits(mmmBal, 18));

  // OPTIONAL: unwrap all WMON -> MON
  if (wmonBal > 0n) {
    console.log("Unwrapping WMON -> MON...");
    const tx3 = await wmon.withdraw(wmonBal);
    await tx3.wait();
    console.log("✅ Unwrapped to MON.");
  }

  const monBal = await ethers.provider.getBalance(me);
  console.log("MON balance now:", ethers.formatEther(monBal));
  console.log("Burn tx:", rcpt.hash);
}

main().catch((e) => { console.error(e); process.exit(1); });
