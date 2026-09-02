---

# 17.5 — docs/retry/developer-guide.md

```markdown
# Developer Guide


## Basic Usage


```javascript
await retryClient.retry(
 async()=>{

   return service.execute();

 }
);
Database

await retryClient.database(
 ()=>repository.save(data)
);

Payment

await retryClient.payment(
 ()=>momo.collect()
);

External API

await retryClient.apiCall(
 ()=>axios.get(url)
);

Context

Automatically propagated:

tenant
user
request
trace
correlation
