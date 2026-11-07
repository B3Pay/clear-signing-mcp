# Draft: SpokePoolPeriphery on chain 1

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 1:0x97CCDBea4632140639aD5eA9b944aa034eb15fD4
- Protocol: across
- Owner: Across Protocol, https://across.to
- ABI: sourcify, SpokePoolPeriphery at 0x97CCDBea4632140639aD5eA9b944aa034eb15fD4
- Descriptor: calldata-SpokePoolPeriphery.json; tests: testsv2/calldata-SpokePoolPeriphery.tests.json (4)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x609ea081 depositNative: 300 senders, 343 calls, 74.6% of senders.
- 0x110560ad swapAndBridge: 93 senders, 106 calls, 23.1% of senders.
- 0x711bc67b depositWithAuthorization: 3 senders, 334 calls, 0.7% of senders.
- 0xd2aca1a4 depositWithPermit2: 3 senders, 211 calls, 0.7% of senders.
- The draft describes 4 function(s): 99.3% of the sample's 402 senders per function called.

- `depositNative(address spokePool,address depositor,bytes32 recipient,address inputToken,uint256 inputAmount,bytes32 outputToken,uint256 outputAmount,uint256 destinationChainId,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityParameter,bytes message)`: Bridge ("Bridge {inputAmount} to {destinationChainId}")
- `swapAndBridge(((uint256 amount,address recipient) submissionFees,(address inputToken,bytes32 outputToken,uint256 outputAmount,address depositor,bytes32 recipient,uint256 destinationChainId,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityParameter,bytes message) depositData,address swapToken,address exchange,uint8 transferType,uint256 swapTokenAmount,uint256 minExpectedInputTokenAmount,bytes routerCalldata,bool enableProportionalAdjustment,address spokePool,uint256 nonce) swapAndDepositData)`: Swap ("Swap {swapAndDepositData.swapTokenAmount} for {swapAndDepositData.depositData.outputAmount}")
- `depositWithAuthorization(address signatureOwner,((uint256 amount,address recipient) submissionFees,(address inputToken,bytes32 outputToken,uint256 outputAmount,address depositor,bytes32 recipient,uint256 destinationChainId,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityParameter,bytes message) baseDepositData,uint256 inputAmount,address spokePool,uint256 nonce) depositData,uint256 validAfter,uint256 validBefore,bytes receiveWithAuthSignature)`: Bridge
- `depositWithPermit2(address signatureOwner,((uint256 amount,address recipient) submissionFees,(address inputToken,bytes32 outputToken,uint256 outputAmount,address depositor,bytes32 recipient,uint256 destinationChainId,bytes32 exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityParameter,bytes message) baseDepositData,uint256 inputAmount,address spokePool,uint256 nonce) depositData,((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,bytes signature)`: Bridge ("Bridge {permit.permitted.amount} to {depositData.baseDepositData.destinationChainId}")

## Review notes

- depositNative (0x609ea081): recipient is a bytes32 recipient on the destination chain, which need not be an EVM address: it is shown raw.
- depositNative (0x609ea081): outputAmount is counted in a token on the chain at destinationChainId, not on this one; a wallet needs that chain's token list to show it.
- depositNative (0x609ea081): message (bytes) is shown raw.
- depositNative (0x609ea081): inputToken is hidden: the amount counted in it shows its symbol.
- depositNative (0x609ea081): outputToken is hidden: the amount counted in it shows its symbol.
- swapAndBridge (0x110560ad): swapAndDepositData.submissionFees.amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapAndBridge (0x110560ad): swapAndDepositData.depositData.outputAmount is counted in a token on the chain at swapAndDepositData.depositData.destinationChainId, not on this one; a wallet needs that chain's token list to show it.
- swapAndBridge (0x110560ad): swapAndDepositData.depositData.recipient is a bytes32 recipient on the destination chain, which need not be an EVM address: it is shown raw.
- swapAndBridge (0x110560ad): swapAndDepositData.depositData.message (bytes) is shown raw.
- swapAndBridge (0x110560ad): swapAndDepositData.routerCalldata looks like call data, but no parameter names the contract it calls: it is shown raw.
- swapAndBridge (0x110560ad): swapAndDepositData.depositData.outputToken is hidden: the amount counted in it shows its symbol.
- swapAndBridge (0x110560ad): swapAndDepositData.swapToken is hidden: the amount counted in it shows its symbol.
- depositWithAuthorization (0x711bc67b): depositData.submissionFees.amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- depositWithAuthorization (0x711bc67b): depositData.baseDepositData.outputAmount is counted in a token on the chain at depositData.baseDepositData.destinationChainId, not on this one; a wallet needs that chain's token list to show it.
- depositWithAuthorization (0x711bc67b): depositData.baseDepositData.recipient is a bytes32 recipient on the destination chain, which need not be an EVM address: it is shown raw.
- depositWithAuthorization (0x711bc67b): depositData.baseDepositData.message (bytes) is shown raw.
- depositWithAuthorization (0x711bc67b): depositData.inputAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- depositWithAuthorization (0x711bc67b): receiveWithAuthSignature is hidden: a signature is not for reading.
- depositWithAuthorization (0x711bc67b): depositData.baseDepositData.outputToken is hidden: the amount counted in it shows its symbol.
- depositWithPermit2 (0xd2aca1a4): depositData.submissionFees.amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- depositWithPermit2 (0xd2aca1a4): depositData.baseDepositData.outputAmount is counted in a token on the chain at depositData.baseDepositData.destinationChainId, not on this one; a wallet needs that chain's token list to show it.
- depositWithPermit2 (0xd2aca1a4): depositData.baseDepositData.recipient is a bytes32 recipient on the destination chain, which need not be an EVM address: it is shown raw.
- depositWithPermit2 (0xd2aca1a4): depositData.baseDepositData.message (bytes) is shown raw.
- depositWithPermit2 (0xd2aca1a4): depositData.inputAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- depositWithPermit2 (0xd2aca1a4): signature is hidden: a signature is not for reading.
- depositWithPermit2 (0xd2aca1a4): depositData.baseDepositData.outputToken is hidden: the amount counted in it shows its symbol.
- depositWithPermit2 (0xd2aca1a4): permit.permitted.token is hidden: the amount counted in it shows its symbol.
- depositNative (0x609ea081), tx 0x9e8b26f4cf8a0928def6146143e45461d889dd15f8ab8179bb6da5b7e3ae18d0: "Amount to receive" shows "40508182658930": a raw number where a token amount belongs (UNKNOWN_TOKEN for token 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73).
- swapAndBridge (0x110560ad), tx 0x742cd5d765c9b9ffefc3b621019f43d7baba27780dccbafe21401c8ac09a557b: "Amount to receive" shows "1326619168327370": a raw number where a token amount belongs (UNKNOWN_TOKEN for token 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1).
- depositWithAuthorization (0x711bc67b), tx 0xc3c0e1d324df26b3f7a4251dbf6cab9794a5bd01779a2e1bf8c16e4ede2b230c: "Amount to receive" shows "10500000": a raw number where a token amount belongs (UNKNOWN_TOKEN for token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
- depositWithPermit2 (0xd2aca1a4), tx 0xf96852caf948ce53b77ce8ac839ddd000de3019995d29380e16ee15c7d5cbd24: "Amount to receive" shows "472500000": a raw number where a token amount belongs (UNKNOWN_TOKEN for token 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
