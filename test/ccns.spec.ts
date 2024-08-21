import { changeNetwork, config, ethers, network, run } from "hardhat";
import { expect } from "chai";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import {
  CCIPLocalSimulator,
  CCIPLocalSimulator__factory,
  CrossChainNameServiceLookup,
  CrossChainNameServiceLookup__factory,
  CrossChainNameServiceReceiver,
  CrossChainNameServiceReceiver__factory,
  CrossChainNameServiceRegister,
  CrossChainNameServiceRegister__factory
} from "../typechain-types";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Spinner } from "../utils/spinner";
import "../tasks";
import { __deploymentsPath, getDeploymentInfo, getRouterConfig } from "../tasks/utils";


describe("CCIP cross-chain name service", async function () {
  async function getLocalSimulatorConfig() {
    const spinner: Spinner = new Spinner();
    const [alice] = await ethers.getSigners();
    console.log({alice});

    console.log(`ℹ️  Attempting to deploy CCIPLocalSimulator on the ${network.name} blockchain using ${alice.address} address`);
    spinner.start();

    const localSimulatorFactory: CCIPLocalSimulator__factory = await ethers.getContractFactory('CCIPLocalSimulator');
    const localSimulator: CCIPLocalSimulator = await localSimulatorFactory.connect(alice).deploy();
    await localSimulator.deployed();

    spinner.stop();
    console.log(`✅ CCIPLocalSimulator deployed at address ${localSimulator.address} on ${network.name} blockchain`);

    console.log(`ℹ️  Attempting to call the config function of the LocalSimulator smart contract`);
    spinner.start();

    const config = await localSimulator.configuration();

    spinner.stop();
    console.log(`✅ Configuration fetched:\n chainSelector: ${config.chainSelector_}\n sourceRouter: ${config.sourceRouter_}\n destinationRouter: ${config.destinationRouter_}`);

    return {
      sourceRouter: config.sourceRouter_,
      destinationRouter: config.destinationRouter_,
      alice: alice
    }
  };

  /** Sets up the Cross Chain Name Service on the source network by deploying Lookup and Register smart contracts and linking them 
   * @param router The address of the Chainlink CCIP Router contract on the source blockchain
  */
  async function deploySourceChain(router: any) {
    if (network.name !== config.defaultNetwork) {
      console.error(`❌ CrossChainNameServiceRegister can be deployed on the source chain only. Source chain - ${config.defaultNetwork}`);
      return;
    }

    const spinner: Spinner = new Spinner();
    const [deployer] = await ethers.getSigners();

    console.log(`ℹ️  Attempting to deploy CrossChainNameServiceLookup on the ${network.name} blockchain using ${deployer.address} address`);
    spinner.start();

    const ccnsLookupFactory: CrossChainNameServiceLookup__factory = await ethers.getContractFactory('CrossChainNameServiceLookup');
    const ccnsLookup: CrossChainNameServiceLookup = await ccnsLookupFactory.connect(deployer).deploy();
    await ccnsLookup.deployed();

    spinner.stop();
    console.log(`✅ CrossChainNameServiceLookup deployed at address ${ccnsLookup.address} on ${network.name} blockchain`);

    console.log(`ℹ️  Attempting to deploy CrossChainNameServiceRegister on the ${network.name} blockchain using ${deployer.address} address`);
    spinner.start();

    const routerAddress = router ? router : getRouterConfig(network.name).address;

    const ccnsRegisterFactory: CrossChainNameServiceRegister__factory = await ethers.getContractFactory('CrossChainNameServiceRegister');
    const ccnsRegister: CrossChainNameServiceRegister = await ccnsRegisterFactory.deploy(routerAddress, ccnsLookup.address);
    await ccnsRegister.deployed();

    spinner.stop();
    console.log(`✅ CrossChainNameServiceRegister deployed at address ${ccnsRegister.address} on ${network.name} blockchain`);


    const filePath = join(__deploymentsPath, `${network.name}.json`);
    !existsSync(__deploymentsPath) && mkdirSync(__deploymentsPath);

    let data;
    try {
      data = {
        "network": network.name,
        "ccnsRegister": ccnsRegister.address,
        "ccnsLookup": ccnsLookup.address
      };

      writeFileSync(filePath, JSON.stringify(data));
    } catch (error) {
      console.log(`ℹ️  Saving the CrossChainNameRegister address to ${filePath} file failed, please save it manually from previous log, you will need it for further tasks`);
      console.error(`Error: ${error}`);
    }


    console.log(`ℹ️  Attempting to call the setCrossChainNameServiceAddress function on the CrossChainNameServiceLookup smart contract`);
    spinner.start();

    const tx = await ccnsLookup.setCrossChainNameServiceAddress(ccnsRegister.address);
    await tx.wait();

    spinner.stop();
    console.log(`✅ CCNS Address set, transaction hash: ${tx.hash}`);

    console.log(`✅ Task deploy-source-chain finished with the execution`);

    return data;
  }

  /** Sets up the Cross Chain Name Service on the destination network by deployed Lookup and Receiver smart contracts and linking them
     * @param register CrossChainNameServiceRegister smart contract address
     * @param scSelector Source Chain Selector
     * @param router The address of the Chainlink CCIP Router contract on the destination blockchain
     */
async function deployDestinationChain(register: any, router: any, deployer: any) {
    if (network.name === config.defaultNetwork) {
      console.error(`❌ CrossChainNameServiceReceiver can not be deployed on the source chain. Source chain - ${config.defaultNetwork}`);
      return;
    }

    const ccnsRegisterAddress = register ? register : getDeploymentInfo(config.defaultNetwork).ccnsRegister;

    if (!ccnsRegisterAddress) {
      console.error(`❌ CrossChainNameServiceRegister address is undefined. Did you run the "npx hardhat deploy-source-chain" command? Was the "${join(__deploymentsPath, `${config.defaultNetwork}.json`)}" file generated? Try to provide the address of a CrossChainNameServiceRegister smart contract via --register flag.`);
      return;
    }

    const spinner: Spinner = new Spinner();

    console.log(`ℹ️  Attempting to deploy CrossChainNameServiceLookup on the ${network.name} blockchain using ${deployer.address} address`);
    spinner.start();

    const ccnsLookupFactory: CrossChainNameServiceLookup__factory = await ethers.getContractFactory('CrossChainNameServiceLookup');
    const ccnsLookup: CrossChainNameServiceLookup = await ccnsLookupFactory.connect(deployer).deploy();
    await ccnsLookup.deployed();

    spinner.stop();
    console.log(`✅ CrossChainNameServiceLookup deployed at address ${ccnsLookup.address} on ${network.name} blockchain`);


    console.log(`ℹ️  Attempting to deploy CrossChainNameServiceReceiver on the ${network.name} blockchain`);
    spinner.start();

    const routerAddress = router ? router : getRouterConfig(network.name).address;
    const sourceChainSelector = getRouterConfig(config.defaultNetwork).chainSelector;

    const ccnsReceiverFactory: CrossChainNameServiceReceiver__factory = await ethers.getContractFactory('CrossChainNameServiceReceiver');
    const ccnsReceiver: CrossChainNameServiceReceiver = await ccnsReceiverFactory.connect(deployer).deploy(routerAddress, ccnsLookup.address, sourceChainSelector);
    await ccnsReceiver.deployed();

    spinner.stop();
    console.log(`✅ CrossChainNameServiceReceiver deployed at address ${ccnsReceiver.address} on ${network.name} blockchain`);

    const filePath = join(__deploymentsPath, `${network.name}.json`);
    !existsSync(__deploymentsPath) && mkdirSync(__deploymentsPath);

    let data;
    try {
      data = {
        "network": network.name,
        "ccnsReceiver": ccnsReceiver.address,
        "ccnsLookup": ccnsLookup.address
      };

      writeFileSync(filePath, JSON.stringify(data));
    } catch (error) {
      console.log(`ℹ️  Saving the CrossChainNameReceiver address to ${filePath} file failed, please save it manually from previous log, you will need it for further tasks`);
      console.error(`Error: ${error}`);
    }

    console.log(`ℹ️  Attempting to call the setCrossChainNameServiceAddress function on the CrossChainNameServiceLookup smart contract`);
    spinner.start();

    const tx = await ccnsLookup.connect(deployer).setCrossChainNameServiceAddress(ccnsReceiver.address);
    await tx.wait();

    spinner.stop();
    console.log(`✅ CCNS Address set, transaction hash: ${tx.hash}`);

    console.log(`✅ Task deploy-destination-chain finished with the execution`);

    return data;
  }

  /** Enables previously deployed CrossChainNameServiceReceiver contract on the source chain
   * @param receiverNetwork The network you used in the deployDestinationChainStep1 function
   * @param register CrossChainNameServiceRegister smart contract address
   * @param receiver CrossChainNameServiceReceiver smart contract address
   * @param dcSelector Destination Chain Selector
   */
  async function enableReceiver(receiverNetwork: any, register: any, receiver: any, caller: any) {
    if (network.name !== config.defaultNetwork) {
      console.error(`❌ Task two must be executed on the source chain. Source chain - ${config.defaultNetwork}`);
      return;
    }

    const ccnsRegisterAddress = register ? register : getDeploymentInfo(config.defaultNetwork).ccnsRegister;

    if (!ccnsRegisterAddress) {
      console.error(`❌ CrossChainNameServiceRegister address is undefined. Did you run the "npx hardhat deploy-source-chain" command? Was the "${join(__deploymentsPath, `${config.defaultNetwork}.json`)}" file generated? Try to provide the address of a CrossChainNameServiceRegister smart contract via --register flag.`);
      return;
    }

    const destinationChainSelector = getRouterConfig(receiverNetwork).chainSelector;
    const ccnsReceiverAddress = receiver ? receiver : getDeploymentInfo(receiverNetwork).ccnsReceiver;

    const ccnsRegister: CrossChainNameServiceRegister = CrossChainNameServiceRegister__factory.connect(ccnsRegisterAddress, caller);

    const spinner: Spinner = new Spinner();

    console.log(`ℹ️  Attempting to call the enableChain function on the CrossChainNameServiceRegister smart contract on the ${network.name} blockchain`);
    spinner.start();

    const tx = await ccnsRegister.connect(caller).enableChain(destinationChainSelector, ccnsReceiverAddress, 200_000);
    await tx.wait();

    spinner.stop();
    console.log(`✅ New Chain enabled, transaction hash: ${tx.hash}`);

    console.log(`✅ Task enable-receiver finished with the execution`);
  }

  /** Register new .ccns name
   * @param ccnsName CCNS Name you want to register, it must ends with .ccns
   * @param register CrossChainNameServiceRegister smart contract address
  */
  async function register(ccnsName: any, register: any, caller: any) {
    if (network.name !== config.defaultNetwork) {
      console.error(`❌ Registering a new .ccns name must be done on the source chain. Source chain - ${config.defaultNetwork}`);
      return;
    }

    if (!ccnsName.endsWith(`.ccns`)) {
      console.error(`❌ Name must ends with .ccns`)
      return;
    }

    const ccnsRegisterAddress = register ? register : getDeploymentInfo(config.defaultNetwork).ccnsRegister;

    if (!ccnsRegisterAddress) {
      console.error(`❌ CrossChainNameServiceRegister address is undefined. Did you run the "npx hardhat deploy-source-chain" command? Was the "${join(__deploymentsPath, `${config.defaultNetwork}.json`)}" file generated? Try to provide the address of a CrossChainNameServiceRegister smart contract via --register flag.`);
      return;
    }

    const ccnsRegister: CrossChainNameServiceRegister = CrossChainNameServiceRegister__factory.connect(ccnsRegisterAddress, caller);

    const spinner: Spinner = new Spinner();

    console.log(`ℹ️  Attempting to call the register function on the CrossChainNameServiceRegister smart contract with the name ${ccnsName} on the ${network.name} blockchain`);
    spinner.start();

    const tx = await ccnsRegister.connect(caller).register(ccnsName);
    await tx.wait();

    spinner.stop();
    console.log(`✅ Transaction hash: ${tx.hash}`);

    console.log(`✅ Task ccns-register finished with the execution`);
  }

  async function lookup(ccnsName: any, lookup: any, caller: any) {
    const ccnsLookupAddress = lookup ? lookup : getDeploymentInfo(network.name).ccnsLookup;

    if (!ccnsLookupAddress) {
      console.error(`❌ CrossChainNameServiceLookup address is undefined. Try to provide the address of a CrossChainNameServiceLookup smart contract via --lookup flag.`);
      return;
    }

    const ccnsLookup: CrossChainNameServiceLookup = CrossChainNameServiceLookup__factory.connect(ccnsLookupAddress, ethers.provider);

    const address = await ccnsLookup.connect(caller).lookup(ccnsName);

    return address;
  }

  it("should register and lookup cross-chain service", async () => {
    const { sourceRouter, destinationRouter, alice }: any = await getLocalSimulatorConfig();
    const ALICE_CCNS = "alice.ccns";
    const DESTINATION_CHAIN = "optimismSepolia";
    const spinner: Spinner = new Spinner();

    // *** Create instances of CrossChainNameServiceRegister.sol and CrossChainNameServiceLookup.sol on the source chain ***
    const sourceChainInfo: { network: any, ccnsRegister: any, ccnsLookup: any } | undefined = await deploySourceChain(sourceRouter);

    // *** Create instances of CrossChainNameServiceReceiver.sol and CrossChainNameServiceLookup.sol on the destination chain ***
    changeNetwork(DESTINATION_CHAIN);
    const destinationChainInfo: { network: any, ccnsReceiver: any, ccnsLookup: any } | undefined = await deployDestinationChain(sourceChainInfo?.ccnsRegister, destinationRouter, alice);

    // *** Enable the previously deployed CrossChainNameServiceReceiver contract on the destination chain ***
    changeNetwork(config.defaultNetwork);
    await enableReceiver(DESTINATION_CHAIN, sourceChainInfo?.ccnsRegister, destinationChainInfo?.ccnsReceiver, alice);

    // *** Register cross-chain name service ***
    await register(ALICE_CCNS, sourceChainInfo?.ccnsRegister, alice);

    // *** Lookup the previously registered cross-chain name service on the source chain ***

    console.log(`ℹ️  Attempting to call the lookup function on the CrossChainNameServiceLookup smart contract on the ${network.name} blockchain`);
    spinner.start();
    const sourceAddress = await lookup(ALICE_CCNS, sourceChainInfo?.ccnsLookup, alice);

    spinner.stop();
    console.log(`✅  ${ALICE_CCNS} resolved with ${sourceAddress}`);

    expect(sourceAddress).to.equal(alice.address);

    // *** Lookup the previously registered cross-chain name service on the destination chain ***
    changeNetwork(DESTINATION_CHAIN);
    console.log(`ℹ️  Attempting to call the lookup function on the CrossChainNameServiceLookup smart contract on the ${network.name} blockchain`);
    spinner.start();

    const destinationAddress = await lookup(ALICE_CCNS, destinationChainInfo?.ccnsLookup, alice);

    spinner.stop();
    console.log(`✅  ${ALICE_CCNS} resolved with ${destinationAddress}`);

    expect(destinationAddress).to.equal(alice.address);
  }).timeout(1000000);
});