async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
  
    // 1) WMON (WETH9)
    const WETH9 = await ethers.getContractFactory("WETH9");
    const wmon = await WETH9.deploy();
    await wmon.deployed();
    console.log("WMON (WETH9):", wmon.address);
  
    // 2) Factory
    const Factory = await ethers.getContractFactory("UniswapV2Factory");
    const factory = await Factory.deploy(deployer.address); // feeToSetter
    await factory.deployed();
    console.log("Factory:", factory.address);
  
    // 3) Router02
    const Router = await ethers.getContractFactory("UniswapV2Router02");
    const router = await Router.deploy(factory.address, wmon.address);
    await router.deployed();
    console.log("Router:", router.address);
  
    // Optional: set feeTo etc later
  }
  
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
  