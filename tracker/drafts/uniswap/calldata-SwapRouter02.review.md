# Draft: SwapRouter02 on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x2626664c2603336E57B271c5C0b26F421741e481
- Protocol: uniswap
- Owner: Uniswap, https://app.uniswap.org
- ABI: sourcify, SwapRouter02 at 0x2626664c2603336E57B271c5C0b26F421741e481
- Descriptor: calldata-SwapRouter02.json; tests: testsv2/calldata-SwapRouter02.tests.json (4)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x5ae401dc multicall: 296 senders, 440 calls, 73.6% of senders.
- 0x04e45aaf exactInputSingle: 72 senders, 345 calls, 17.9% of senders.
- 0xac9650d8 multicall: 21 senders, 40 calls, 5.2% of senders.
- 0xb858183f exactInput: 10 senders, 33 calls, 2.5% of senders.
- 87 plain transfers (no calldata) in the sample are left out.
- The draft describes 4 function(s): 99.3% of the sample's 402 senders per function called.

- `multicall(uint256 deadline,bytes[] data)`: Multicall
- `exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)`: Swap ("Swap {params.amountIn} for at least {params.amountOutMinimum}")
- `multicall(bytes[] data)`: Multicall
- `exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params)`: Swap

## Review notes

- multicall (0x5ae401dc): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- exactInputSingle (0x04e45aaf): params.tokenIn is hidden: the amount counted in it shows its symbol.
- exactInputSingle (0x04e45aaf): params.tokenOut is hidden: the amount counted in it shows its symbol.
- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- exactInput (0xb858183f): params.path (bytes) is shown raw.
- exactInput (0xb858183f): params.amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- exactInput (0xb858183f): params.amountOutMinimum looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- multicall (0xac9650d8), tx 0x4084ac1de55f6f0a08af8fd8131e40035dc123e0c18ebca3b7021ab85f2c771f: "Action" shows "0x49404b7c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000065cb5a552af1aefd8d1a7ac38e14a760b924c0e4": raw call data: the call it carries did not render (NO_FORMAT_MATCH).
