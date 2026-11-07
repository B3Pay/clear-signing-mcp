# Draft: OpenOceanExchangeProxy on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x6352a56caadC4F1E25CD6c75970Fa768A3304e64
- Protocol: openocean
- Owner: OpenOcean, https://openocean.finance
- ABI: sourcify, OpenOceanExchange at 0x201263Cea08e8F1D6E2fdd1FD2cA44bf6145e2AF
- Descriptor: calldata-OpenOceanExchangeProxy.json; tests: testsv2/calldata-OpenOceanExchangeProxy.tests.json (2)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x90411a32 swap: 82 senders, 268 calls, 87.2% of senders.
- 0x0a9704d5 simpleSwap: 12 senders, 13 calls, 12.8% of senders.
- The draft describes 2 function(s): 100.0% of the sample's 94 senders per function called.

- `swap(address caller,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 guaranteedAmount,uint256 flags,address referrer,bytes permit) desc,(uint256 target,uint256 gasLimit,uint256 value,bytes data)[] calls)`: Swap ("Swap for at least {desc.minReturnAmount}")
- `simpleSwap(address caller,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,address referrer,bytes permit) desc,(uint256 target,uint256 gasLimit,uint256 value,bytes data)[] calls)`: Swap ("Swap for at least {desc.minReturnAmount}")

## Review notes

- swap (0x90411a32): desc.amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swap (0x90411a32): desc.guaranteedAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swap (0x90411a32): desc.permit (bytes) is shown raw.
- swap (0x90411a32): calls.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swap (0x90411a32): calls.[].data looks like call data, but no parameter names the contract it calls: it is shown raw.
- swap (0x90411a32): desc.dstToken is hidden: the amount counted in it shows its symbol.
- simpleSwap (0x0a9704d5): desc.amount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- simpleSwap (0x0a9704d5): desc.permit (bytes) is shown raw.
- simpleSwap (0x0a9704d5): calls.[].value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- simpleSwap (0x0a9704d5): calls.[].data looks like call data, but no parameter names the contract it calls: it is shown raw.
- simpleSwap (0x0a9704d5): desc.dstToken is hidden: the amount counted in it shows its symbol.
