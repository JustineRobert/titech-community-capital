/**
 * TITech Community Capital LTD
 * KYC Verification Pipeline
 */


class KYCVerificationPipeline {


async execute(customer){


const issues=[];


if(
!customer.identityVerified
){

issues.push(
"IDENTITY_NOT_VERIFIED"
);

}


if(
customer.documentExpired
){

issues.push(
"KYC_DOCUMENT_EXPIRED"
);

}



return {


passed:
issues.length===0,


issues,


status:
issues.length
?
"REVIEW"
:
"VERIFIED"


};



}


}


module.exports =
new KYCVerificationPipeline();