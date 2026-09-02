/**
 * ============================================================================
 * TITech Community Capital LTD
 * Callback Signature Service
 * ============================================================================
 */


const crypto =
require("crypto");


class CallbackSignatureService {



verifyHmac({

payload,

signature,

secret

}) {



const hash =
crypto
.createHmac(
"sha256",
secret
)
.update(
JSON.stringify(payload)
)
.digest(
"hex"
);



return hash === signature;


}



}



module.exports =
CallbackSignatureService;