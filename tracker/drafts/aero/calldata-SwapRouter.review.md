# Draft: SwapRouter on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418
- Protocol: aero
- Owner: Aero (Aerodrome + Velodrome), https://aero.xyz
- ABI: sourcify, SwapRouter at 0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418
- Descriptor: calldata-SwapRouter.json; tests: testsv2/calldata-SwapRouter.tests.json (4)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xa026383e exactInputSingle: 59 senders, 717 calls, 73.8% of senders.
- 0xc714e838 exactOutputSingle: 9 senders, 252 calls, 11.3% of senders.
- 0xc04b8d59 exactInput: 8 senders, 11 calls, 10.0% of senders.
- 0xac9650d8 multicall: 4 senders, 20 calls, 5.0% of senders.
- The draft describes 4 function(s): 100.0% of the sample's 80 senders per function called.

- `exactInputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)`: Swap ("Swap {params.amountIn} for at least {params.amountOutMinimum}")
- `exactOutputSingle((address tokenIn,address tokenOut,int24 tickSpacing,address recipient,uint256 deadline,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96) params)`: Swap ("Swap at most {params.amountInMaximum} for {params.amountOut}")
- `exactInput((bytes path,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum) params)`: Swap
- `multicall(bytes[] data)`: Multicall

## Review notes

- exactInputSingle (0xa026383e): params.tokenIn is hidden: the amount counted in it shows its symbol.
- exactInputSingle (0xa026383e): params.tokenOut is hidden: the amount counted in it shows its symbol.
- exactOutputSingle (0xc714e838): params.tokenIn is hidden: the amount counted in it shows its symbol.
- exactOutputSingle (0xc714e838): params.tokenOut is hidden: the amount counted in it shows its symbol.
- exactInput (0xc04b8d59): params.path (bytes) is shown raw.
- exactInput (0xc04b8d59): params.amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- exactInput (0xc04b8d59): params.amountOutMinimum looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
