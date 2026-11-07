# Draft: Router on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
- Protocol: aerodrome
- Owner: Aerodrome (legacy, now Aero), https://aerodrome.finance
- ABI: sourcify, Router at 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
- Descriptor: calldata-Router.json; tests: testsv2/calldata-Router.tests.json (6)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xcac88ea9 swapExactTokensForTokens: 239 senders, 931 calls, 89.5% of senders.
- 0x12bc3aca swapExactTokensForETHSupportingFeeOnTransferTokens: 6 senders, 26 calls, 2.2% of senders.
- 0x3da5acba swapExactETHForTokensSupportingFeeOnTransferTokens: 6 senders, 22 calls, 2.2% of senders.
- 0x903638a4 swapExactETHForTokens: 6 senders, 8 calls, 2.2% of senders.
- 0xc6b7f1b6 swapExactTokensForETH: 5 senders, 5 calls, 1.9% of senders.
- 0x88cd821e swapExactTokensForTokensSupportingFeeOnTransferTokens: 3 senders, 5 calls, 1.1% of senders.
- The draft describes 6 function(s): 99.3% of the sample's 267 senders per function called.

- `swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline)`: Swap
- `swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline)`: Swap ("Swap for at least {amountOutMin}")
- `swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline)`: Swap ("Swap {@.value}")
- `swapExactETHForTokens(uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline)`: Swap ("Swap {@.value}")
- `swapExactTokensForETH(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline)`: Swap ("Swap for at least {amountOutMin}")
- `swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline)`: Swap

## Review notes

- swapExactTokensForTokens (0xcac88ea9): amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactTokensForTokens (0xcac88ea9): amountOutMin looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactTokensForETHSupportingFeeOnTransferTokens (0x12bc3aca): amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactETHForTokensSupportingFeeOnTransferTokens (0x3da5acba): amountOutMin looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactETHForTokens (0x903638a4): amountOutMin looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactTokensForETH (0xc6b7f1b6): amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactTokensForTokensSupportingFeeOnTransferTokens (0x88cd821e): amountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapExactTokensForTokensSupportingFeeOnTransferTokens (0x88cd821e): amountOutMin looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
