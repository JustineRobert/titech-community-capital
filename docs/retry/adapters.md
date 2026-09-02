# Retry Adapters


Adapters provide technology awareness.


Supported:


| Adapter | Purpose |
|-|-|
| MongoDB | Database operations |
| Mongoose | ODM operations |
| Redis | Cache and queue |
| Axios | HTTP APIs |
| Fetch | HTTP APIs |
| MTN MoMo | Payments |
| Airtel Money | Payments |
| Kafka | Events |
| RabbitMQ | Messaging |
| BullMQ | Jobs |
| Filesystem | Storage |


Example:


```javascript

await retryAdapters.mongodb.execute(
 async()=>{

   return Loan.findById(id);

 }
);
