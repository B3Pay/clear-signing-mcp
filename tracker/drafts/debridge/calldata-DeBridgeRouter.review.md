# Draft: DeBridgeRouter on chain 1

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 1:0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251
- Protocol: debridge
- Owner: deBridge (DLN), https://debridge.finance
- ABI: blockscout, DeBridgeRouter at 0xCe56012E880851baa234cD092aF516A0fcA9CFe3
- Descriptor: calldata-DeBridgeRouter.json; tests: testsv2/calldata-DeBridgeRouter.tests.json (2)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x4d8160ba strictlySwapAndCall: 260 senders, 343 calls, 83.3% of senders.
- 0x258c16ee swap: 50 senders, 79 calls, 16.0% of senders.
- The draft describes 2 function(s): 99.4% of the sample's 312 senders per function called.

- `strictlySwapAndCall(address _srcTokenIn,uint256 _srcAmountIn,bytes _srcTokenInPermitEnvelope,address _srcSwapRouter,bytes _srcSwapCalldata,address _srcTokenOut,uint256 _srcTokenExpectedAmountOut,address _srcTokenRefundRecipient,address _target,bytes _targetData)`: Swap
- `swap(address _tokenIn,uint256 _amountIn,bytes _tokenInPermitEnvelope,(address allowanceAggregator,address swapRouter,bytes swapCalldata,address tokenOut,uint256 tokenOutMinAmount,uint16 surplusShareBps,bytes affiliateFeeEnvelope,address recipient) _swapDetails,uint32 _referralCode)`: Swap ("Swap {_amountIn} for at least {_swapDetails.tokenOutMinAmount}")

## Review notes

- strictlySwapAndCall (0x4d8160ba): _srcAmountIn looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- strictlySwapAndCall (0x4d8160ba): _srcTokenInPermitEnvelope (bytes) is shown raw.
- strictlySwapAndCall (0x4d8160ba): _srcSwapCalldata is a call to _target: a wallet shows it through that contract's descriptor.
- strictlySwapAndCall (0x4d8160ba): _srcTokenExpectedAmountOut looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- strictlySwapAndCall (0x4d8160ba): _targetData is a call to _target: a wallet shows it through that contract's descriptor.
- swap (0x258c16ee): _tokenInPermitEnvelope (bytes) is shown raw.
- swap (0x258c16ee): _swapDetails.swapCalldata looks like call data, but no parameter names the contract it calls: it is shown raw.
- swap (0x258c16ee): _swapDetails.affiliateFeeEnvelope (bytes) is shown raw.
- swap (0x258c16ee): _tokenIn is hidden: the amount counted in it shows its symbol.
- swap (0x258c16ee): _swapDetails.tokenOut is hidden: the amount counted in it shows its symbol.
- swap (0x258c16ee): _amountIn is counted in the native currency when _tokenIn is 0x0000000000000000000000000000000000000000, as the samples send it; check that the contract reads it so.
- strictlySwapAndCall (0x4d8160ba), tx 0xa1c4f07d71ed574effbdd8345d8dfa52c936c3a3fa8a05dd697f1299229f8a62: "Src token in" shows "0x0000000000000000000000000000000000000000": an address where a token symbol belongs (UNKNOWN_TOKEN).
- strictlySwapAndCall (0x4d8160ba), tx 0xa1c4f07d71ed574effbdd8345d8dfa52c936c3a3fa8a05dd697f1299229f8a62: "Src swap calldata" shows "0x3f0bde25b223e6eeda550918638529c6cf2ea14f9ea0572d6f880000000000000000003d18d123407cc80000000000000000000000000246cf0407e6eeda550918638529c6cf2ea14f9ea0572d6f88663dc15d3c1ac63ff12e45ab68fea3f0a883c251eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeea0b86991c6218b36c1d19d4a2e9eb0ce3606eb48c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2e0554a476a092703abdb3ef35c80e0d76d32939f2bfd1fc5e25a8f55c2e849492ad7966ea8a0dd9e7404440504f9022447fbdb0306710301ff": raw call data: the call it carries did not render (NO_DESCRIPTOR).
- strictlySwapAndCall (0x4d8160ba), tx 0xa1c4f07d71ed574effbdd8345d8dfa52c936c3a3fa8a05dd697f1299229f8a62: "Target data" shows "0xb930370100000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000001a1b2da216100000000000000000000000000000000000000000000000000000000000003600000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000038000000000000000000000000000000000000000000000000000000000000003a0000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000246cf04000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000006a45ec8965e46b70000000000000000000000000000000000000000000000000000000005f5e11600000000000000000000000000000000000000000000000000000000000001a00000000000000000000000002f5841978c637aeaa81585358e3c2adf2f5dc3c600000000000000000000000000000000000000000000000000000000000001e00000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000026000000000000000000000000000000000000000000000000000000000000002800000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000142f5841978c637aeaa81585358e3c2adf2f5dc3c600000000000000000000000000000000000000000000000000000000000000000000000000000000000000142f5841978c637aeaa81585358e3c2adf2f5dc3c60000000000000000000000000000000000000000000000000000000000000000000000000000000000000014555ce236c0220695b68341bc48c68d52210cc35b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004201010000006f85059f4dc90000000000000000000000000000b7465e96c85ea406000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000": raw call data: the call it carries did not render (NO_DESCRIPTOR).
