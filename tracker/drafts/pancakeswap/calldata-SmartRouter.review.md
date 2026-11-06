# Draft: SmartRouter on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86
- Protocol: pancakeswap
- Owner: PancakeSwap, https://pancakeswap.finance
- ABI: sourcify, SmartRouter at 0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86
- Descriptor: calldata-SmartRouter.json; tests: testsv2/calldata-SmartRouter.tests.json (5)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x04e45aaf exactInputSingle: 9 senders, 479 calls, 47.4% of senders.
- 0x5023b4df exactOutputSingle: 5 senders, 497 calls, 26.3% of senders.
- 0x5ae401dc multicall: 2 senders, 19 calls, 10.5% of senders.
- 0xac9650d8 multicall: 2 senders, 3 calls, 10.5% of senders.
- 0xb858183f exactInput: 1 senders, 2 calls, 5.3% of senders.
- The draft describes 5 function(s): 100.0% of the sample's 19 senders per function called.

- `exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)`: Swap ("Swap {params.amountIn} for at least {params.amountOutMinimum}")
- `exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96) params)`: Swap ("Swap at most {params.amountInMaximum} for {params.amountOut}")
- `multicall(uint256 deadline,bytes[] data)`: Multicall
- `multicall(bytes[] data)`: Multicall
- `exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params)`: Swap

## Review notes

- exactInputSingle (0x04e45aaf): params.tokenIn is hidden: the amount counted in it shows its symbol.
- exactInputSingle (0x04e45aaf): params.tokenOut is hidden: the amount counted in it shows its symbol.
- exactOutputSingle (0x5023b4df): params.tokenIn is hidden: the amount counted in it shows its symbol.
- exactOutputSingle (0x5023b4df): params.tokenOut is hidden: the amount counted in it shows its symbol.
- multicall (0x5ae401dc): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- exactInput (0xb858183f): params.path (bytes) is shown raw.
- exactInput (0xb858183f): params.amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- exactInput (0xb858183f): params.amountOutMinimum looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- multicall (0xac9650d8), tx 0x3aa70615331f55758c1a9a8ab16f5ce1c440742907feee770155a81e5aedce38: "Action" shows "0x49404b7c00000000000000000000000000000000000000000000000000539a69b016591d000000000000000000000000a68eef15515249e82e25abb5e09e78f4435fc1ef": raw call data: the call it carries did not render (NO_FORMAT_MATCH).
