# Cross-check against the official SoDEX Go SDK (run on your machine)

This signs the same test order with the official SDK so you can compare against Buffer's TypeScript signer.

```bash
git clone --depth 1 https://github.com/sodex-tech/sodex-go-sdk-public.git ../../../sodex-go-sdk-public
cd verify/go
go mod init buffer/verify
go mod edit -require=github.com/sodex-tech/sodex-go-sdk-public@v0.0.0 \
  -replace=github.com/sodex-tech/sodex-go-sdk-public=../../../sodex-go-sdk-public
go mod tidy
go run . 138565 1760373925001
```

It prints the canonical JSON, payloadHash, the Go wire signature and the signer address.
Pass a TS signature as a third argument to have Go recover its signer:

```bash
go run . 138565 1760373925001 0x01...
```

The TS side is covered by `npm test` (`test/sodex.test.ts`), which checks the doc's example payload byte-for-byte and recovers signatures under a hand port of the SDK's EIP-712 digest.
