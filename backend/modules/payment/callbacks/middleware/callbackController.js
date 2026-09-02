/**
 * ============================================================================
 * Callback Controller
 * ============================================================================
 */


class CallbackController {



constructor({

processingEngine

}) {


this.processingEngine =
processingEngine;


}



receive = async(req,res)=>{


try {


const result =
await this.processingEngine.process({

provider:
req.params.provider,


payload:
req.body,


signature:
req.headers["x-signature"],


context:{
ip:
req.ip
}

});



return res.status(200)
.json({

success:true,

data:result

});


}

catch(error){


return res.status(400)
.json({

success:false,

message:
error.message

});


}



}



}



module.exports =
CallbackController;