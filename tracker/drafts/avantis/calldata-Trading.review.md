# Draft: Trading on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x44914408af82bC9983bbb330e3578E1105e11d4e
- Protocol: avantis
- Owner: Veranta (formerly Avantis), https://www.veranta.xyz
- ABI: sourcify, TradingRouter at 0x4a0d70ec00B708879530eEEaef2bb161551fDADc
- Descriptor: calldata-Trading.json; tests: testsv2/calldata-Trading.tests.json (9)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xfb7830cf executeMarketOrderBatched: 50 senders, 456 calls, 37.3% of senders.
- 0x46a8f4cb executeLimitOrder: 23 senders, 32 calls, 17.2% of senders.
- 0x10820f39 executePartialTpSl: 21 senders, 31 calls, 15.7% of senders.
- 0x7aad21e4 executeMarketOrder: 20 senders, 340 calls, 14.9% of senders.
- 0x3d778c12 executePositionUpdateBatched: 12 senders, 14 calls, 9.0% of senders.
- 0x1db3a3e3 executeTwapBatched: 4 senders, 4 calls, 3.0% of senders.
- Skipped 0xe5a97c92 closeTradeMarket (1 senders, 76 calls, 0.7% of senders): no transaction in the sample to test it with.
- 0x9a10cc32 delegatedAction: 1 senders, 45 calls, 0.7% of senders.
- 0x28a9aaa6 executeOpenTwapSlice: 1 senders, 1 calls, 0.7% of senders.
- 0x2a08ecdd executeCloseTwapSlice: 1 senders, 1 calls, 0.7% of senders.
- The draft describes 9 function(s): 99.3% of the sample's 134 senders per function called.

- `executeMarketOrderBatched(uint8 _orderType,bytes _userSignature,bytes _userIntent,bytes[] _priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute market order batched
- `executeLimitOrder(uint8 _orderType,address _trader,uint256 _pairIndex,uint256 _index,bytes[] priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute limit order
- `executePartialTpSl(bytes _userIntent,bytes _signature,bytes[] priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute partial tp sl
- `executeMarketOrder(uint256 orderId,bytes[] priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute market order
- `executePositionUpdateBatched(uint8 _orderType,bytes _userSignature,bytes _userIntent,bytes[] _priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute position update batched
- `executeTwapBatched(uint8 _orderType,bytes _userSignature,bytes _userIntent)`: Execute twap batched
- `delegatedAction(address trader,bytes call_data)`: Delegated action
- `executeOpenTwapSlice((uint256 twapId,uint256 sliceId,uint256 collateral,uint256 leverage,uint256 coinExposure) _slice,bytes[] priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute open twap slice
- `executeCloseTwapSlice((uint256 twapId,uint256 sliceId,uint256 coinSize) _slice,bytes[] priceUpdateData,uint8 _priceSourcing,(int256 spreadP,uint256 bookDepth,int256 impactParam,bool byPass,int256 maxSpreadP,bool slot_1,int256 slot_3) _spreadParams)`: Execute close twap slice

## Review notes

- executeMarketOrderBatched (0xfb7830cf): _userSignature is hidden: a signature is not for reading.
- executeMarketOrderBatched (0xfb7830cf): _userIntent (bytes) is shown raw.
- executeMarketOrderBatched (0xfb7830cf): _priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
- executeLimitOrder (0x46a8f4cb): priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
- executePartialTpSl (0x10820f39): _userIntent (bytes) is shown raw.
- executePartialTpSl (0x10820f39): _signature is hidden: a signature is not for reading.
- executePartialTpSl (0x10820f39): priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
- executeMarketOrder (0x7aad21e4): priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
- executePositionUpdateBatched (0x3d778c12): _userSignature is hidden: a signature is not for reading.
- executePositionUpdateBatched (0x3d778c12): _userIntent (bytes) is shown raw.
- executePositionUpdateBatched (0x3d778c12): _priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
- executeTwapBatched (0x1db3a3e3): _userSignature is hidden: a signature is not for reading.
- executeTwapBatched (0x1db3a3e3): _userIntent (bytes) is shown raw.
- delegatedAction (0x9a10cc32): call_data looks like call data, but no parameter names the contract it calls: it is shown raw.
- executeOpenTwapSlice (0x28a9aaa6): priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
- executeCloseTwapSlice (0x2a08ecdd): priceUpdateData.[] looks like call data, but no parameter names the contract it calls: it is shown raw.
