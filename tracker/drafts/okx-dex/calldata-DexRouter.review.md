# Draft: DexRouter on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x67d03631FE51B741C0C00c4E16eb662AC84381df
- Protocol: okx-dex
- Owner: OKX DEX (OKX Wallet swaps), https://web3.okx.com
- ABI: sourcify, DexRouter at 0x67d03631FE51B741C0C00c4E16eb662AC84381df
- Descriptor: calldata-DexRouter.json; tests: testsv2/calldata-DexRouter.tests.json (3)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x0c307f76 dagSwapTo: 74 senders, 893 calls, 85.1% of senders.
- 0xf2c42696 dagSwapByOrderId: 11 senders, 104 calls, 12.6% of senders.
- 0x08298b5a unxswapTo: 2 senders, 3 calls, 2.3% of senders.
- The draft describes 3 function(s): 100.0% of the sample's 87 senders per function called.

- `dagSwapTo(uint256 orderId,address receiver,(uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest,(address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths)`: Swap ("Swap for at least {baseRequest.minReturnAmount}")
- `dagSwapByOrderId(uint256 orderId,(uint256 fromToken,address toToken,uint256 fromTokenAmount,uint256 minReturnAmount,uint256 deadLine) baseRequest,(address[] mixAdapters,address[] assetTo,uint256[] rawData,bytes[] extraData,uint256 fromToken)[] paths)`: Swap ("Swap for at least {baseRequest.minReturnAmount}")
- `unxswapTo(uint256 srcToken,uint256 amount,uint256 minReturn,address receiver,bytes32[] pools)`: Unxswap to

## Review notes

- dagSwapTo (0x0c307f76): baseRequest.fromTokenAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- dagSwapTo (0x0c307f76): paths.[].mixAdapters.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapTo (0x0c307f76): paths.[].assetTo.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapTo (0x0c307f76): paths.[].rawData.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapTo (0x0c307f76): paths.[].extraData.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapTo (0x0c307f76): baseRequest.toToken is hidden: the amount counted in it shows its symbol.
- dagSwapByOrderId (0xf2c42696): baseRequest.fromTokenAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- dagSwapByOrderId (0xf2c42696): paths.[].mixAdapters.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapByOrderId (0xf2c42696): paths.[].assetTo.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapByOrderId (0xf2c42696): paths.[].rawData.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapByOrderId (0xf2c42696): paths.[].extraData.[] is hidden: the draft does not display an array inside an array of structs (the clear-signing library expands one [] per path).
- dagSwapByOrderId (0xf2c42696): baseRequest.toToken is hidden: the amount counted in it shows its symbol.
- unxswapTo (0x08298b5a): amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- unxswapTo (0x08298b5a): minReturn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
