package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/shopspring/decimal"
	"github.com/sodex-tech/sodex-go-sdk-public/common/enums"
	ctypes "github.com/sodex-tech/sodex-go-sdk-public/common/types"
	"github.com/sodex-tech/sodex-go-sdk-public/common/signer"
	ptypes "github.com/sodex-tech/sodex-go-sdk-public/perps/types"
)

// usage: main <chainID> <nonce> [tsSigHex]
func main() {
	chainID, _ := strconv.ParseUint(os.Args[1], 10, 64)
	nonce, _ := strconv.ParseUint(os.Args[2], 10, 64)
	q := decimal.RequireFromString("0.001")
	sp := decimal.RequireFromString("70500.5")
	st := enums.StopTypeStopLoss
	tt := enums.TriggerTypeMarkPrice
	req := &ptypes.NewOrderRequest{
		AccountID: 12345, SymbolID: 1,
		Orders: []*ptypes.RawOrder{
			{ClOrdID: "my-order-1", Modifier: enums.OrderModifierNormal, Side: enums.OrderSideBuy, Type: enums.OrderTypeMarket, TimeInForce: enums.TimeInForceIOC, Quantity: &q, ReduceOnly: false, PositionSide: enums.PositionSideBoth},
			{ClOrdID: "sl-1", Modifier: enums.OrderModifier(4), Side: enums.OrderSideSell, Type: enums.OrderTypeMarket, TimeInForce: enums.TimeInForceIOC, Quantity: &q, StopPrice: &sp, StopType: &st, TriggerType: &tt, ReduceOnly: true, PositionSide: enums.PositionSideBoth},
		},
	}
	ap := &ctypes.ActionPayload{Type: req.ActionName(), Params: req}
	bz, _ := json.Marshal(ap)
	ph, _ := ap.Hash()
	key, _ := crypto.HexToECDSA("2222222222222222222222222222222222222222222222222222222222222222")
	domain := ctypes.NewEIP712Domain(ctypes.PerpsDomainName, chainID)
	s := signer.NewEVMSigner(&domain)
	sig, err := s.SignAction(req, nonce, key)
	if err != nil { panic(err) }
	fmt.Println("json=" + string(bz))
	fmt.Println("payloadHash=" + ph.Hex())
	fmt.Println("goSig=0x" + hex.EncodeToString(sig))
	fmt.Println("signer=" + crypto.PubkeyToAddress(key.PublicKey).Hex())
	if len(os.Args) > 3 {
		tsSig := common.FromHex(os.Args[3])
		addr, err := ctypes.RecoverExchangeActionSigner(ph, nonce, &domain, tsSig[1:])
		fmt.Printf("recoverTS=%s err=%v\n", addr.Hex(), err)
	}
}
