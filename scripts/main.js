require('dotenv').config();
const starknet = require("starknet");
const ERC20 = require("../contracts/ERC20.json");
const operationCounts = {
    totalCalls: 0,
    success: {
        invoke: 0,
        deploy: 0,
        declare: 0,
        transfer: 0,
        getTransaction: 0
    },
    failure: {
        invoke: 0,
        deploy: 0,
        declare: 0,
        transfer: 0,
        getTransaction: 0
    }
};

function logOperation(operation, success) {
    const outcome = success ? 'success' : 'failure';
    console.log(`${new Date().toISOString()}: ${operation} ${outcome}`);
    operationCounts.totalCalls++;
    operationCounts[outcome][operation]++;
}

const preDeployedPrivateKey = "0x00c1cf1490de1352865301bb8705143f3ef938f97fdf892f1090dcb5ac7bcd1d";
const preDeployedAddress = "0x0000000000000000000000000000000000000000000000000000000000000002";
const feeAddress = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
const provider = new starknet.RpcProvider({nodeUrl: process.env.STARKNET_NODE_URL});
const account = new starknet.Account(provider,
    preDeployedAddress,
    preDeployedPrivateKey,
);
const argentCairo1ClassHash = "0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003";

async function getTransaction(txnHash) {
    try {
        const result = await provider.getTransactionReceipt(txnHash);
        logOperation('getTransaction', true);
    } catch (error) {
        logOperation('getTransaction', false);
    }
}

const sierraPath = "./contracts/ArgentAccount.json";
const casmPath = "./contracts/ArgentAccount.casm.json";
const erc20MintablePath = "./contracts/ERC20MintableOZ051.json";

async function deploy() {
    if (process.env.DETAILED_LOGGING === 'true') {
        console.log("Current operation counts:", operationCounts);
    }
    try {
        const currentDir = process.cwd();
        const casm = require(`${currentDir}/${casmPath}`);
        const sierra = require(`${currentDir}/${sierraPath}`);
        const starkKeyPrivate = starknet.stark.randomAddress();
        console.log('private key=', starkKeyPrivate);
        const starkKeyPublic = starknet.ec.starkCurve.getStarkKey(starkKeyPrivate);
        console.log('public key=', starkKeyPublic);
        try {
            const {suggestedMaxFee: estimatedFee1} = await account.estimateDeclareFee({
                contract: sierra,
                casm: casm,
            });

            const declareTxn = await account.declareIfNot(
                {
                    contract: sierra,
                    casm: casm,
                },
                {
                    maxFee: estimatedFee1 * 11n / 10n
                }
            );
            console.log("Declared = ", declareTxn);
            logOperation('declare', true);
        } catch (error) {
            console.log("Declared error = ", error);
            logOperation('declare', false);
        }

        const addressSalt = starknet.num.toHex(starkKeyPublic);
        const constructorCallData = starknet.CallData.compile({signer: starkKeyPublic, guardian: "0"});
        const contractAddress = starknet.hash.calculateContractAddressFromHash(
            addressSalt,
            argentCairo1ClassHash,
            constructorCallData,
            0,
        );
        console.log('Precalculated account address = ', contractAddress);
        const contract = new starknet.Contract(ERC20.abi, feeAddress, provider);
        contract.connect(account);

        const amount = starknet.cairo.uint256(100000000000000);
        const {transaction_hash: transferTxHash} = await contract.transfer(
            contractAddress,
            amount,
            {
                nonce: account.nonce,
                version: 1,
                maxFee: 200000,
            });

        console.log("Waiting for Tx to be Accepted - Transfer...");

        const transferResult = await provider.waitForTransaction(transferTxHash);

        console.log("Transaction result balance transfer: ", transferResult);

        const bal = await contract.balanceOf(contractAddress);
        console.log("Final balance =", bal.balance);

        const newAccount = new starknet.Account(provider, contractAddress, starkKeyPrivate);
        const deployAccountPayload = {
            classHash: argentCairo1ClassHash,
            constructorCalldata: constructorCallData,
            contractAddress: contractAddress,
            addressSalt: starkKeyPublic,
        };

        const deployContractResponse = await newAccount.deployAccount(
            deployAccountPayload,
            {
                nonce: newAccount.nonce,
                maxFee: 200000,
                version: 1,
            }
        );
        console.log("This is the deploy result - ", deployContractResponse.contract_address);
        logOperation('deploy', true);
        deploy()
    } catch (error) {
        console.error("Failed to deploy contract:", error);
        logOperation('deploy', false);
    }
}

deploy();
