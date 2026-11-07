# Draft: PositionManager on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x7C5f5A4bBd8fD63184577525326123B519429bDc
- Protocol: uniswap
- Owner: Uniswap, https://app.uniswap.org
- ABI: sourcify, PositionManager at 0x7C5f5A4bBd8fD63184577525326123B519429bDc
- Descriptor: calldata-PositionManager.json; tests: testsv2/calldata-PositionManager.tests.json (5)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xdd46508f modifyLiquidities: 234 senders, 787 calls, 60.3% of senders.
- 0xac9650d8 multicall: 140 senders, 189 calls, 36.1% of senders.
- 0xb88d4fde safeTransferFrom: 6 senders, 16 calls, 1.5% of senders.
- 0x23b872dd transferFrom: 3 senders, 3 calls, 0.8% of senders.
- 0x2b9261de subscribe: 2 senders, 2 calls, 0.5% of senders.
- The draft describes 5 function(s): 99.2% of the sample's 388 senders per function called.

- `modifyLiquidities(bytes unlockData,uint256 deadline)`: Modify liquidities
- `multicall(bytes[] data)`: Multicall
- `safeTransferFrom(address from,address to,uint256 id,bytes data)`: Safe transfer from
- `transferFrom(address from,address to,uint256 id)`: Transfer
- `subscribe(uint256 tokenId,address newSubscriber,bytes data)`: Subscribe

## Review notes

- modifyLiquidities (0xdd46508f): unlockData looks like call data, but no parameter names the contract it calls: it is shown raw.
- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- safeTransferFrom (0xb88d4fde): data looks like call data, but no parameter names the contract it calls: it is shown raw.
- subscribe (0x2b9261de): data looks like call data, but no parameter names the contract it calls: it is shown raw.
- multicall (0xac9650d8), tx 0x0d4f842321d0517587e44c0e212bcd579567f13c1c8f1e7231ca6989280f6004: "Action" shows "0xf70204050000000000000000000000006b7da78ecd15e8177d9f3eda83b979dbcf481a06000000000000000000000000fde4c96c8593536e31f229ea8f37b2ada2699bb200000000000000000000000000000000000000000000000000000000000b71b00000000000000000000000000000000000000000000000000000000000001d4c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a1549d7a3680d0fc2ad0a7": raw call data: the call it carries did not render (NO_FORMAT_MATCH).
