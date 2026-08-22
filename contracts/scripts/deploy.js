import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const DonationEscrow = await hre.ethers.getContractFactory("DonationEscrow");
  const escrow = await DonationEscrow.deploy();
  await escrow.waitForDeployment();
  const contractAddress = await escrow.getAddress();
  console.log("Contract deployed to:", contractAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
