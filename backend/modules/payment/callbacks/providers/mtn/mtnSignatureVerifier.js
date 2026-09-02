class MtnSignatureVerifier {


constructor({

signatureService,

secret

}) {

this.signatureService =
signatureService;


this.secret =
secret;

}



async verify({

payload,

signature

}) {


return this.signatureService.verifyHmac({

payload,

signature,

secret:
this.secret

});


}


}


module.exports =
MtnSignatureVerifier;