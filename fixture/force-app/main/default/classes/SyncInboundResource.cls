/**
 * The ERP's way into Salesforce: PATCH /services/apexrest/sync/v1/<Object>/<Id>
 * with {"field": ..., "value": ...}, called by the bridge as the integration user.
 *
 * Why this class exists: every write the ERP makes into Salesforce arrives here, so
 * it commits as the integration user and its change event carries that commitUser,
 * which is how the offline referee tells an echo from an originating write. It also
 * refuses fields outside the contract, so the ERP cannot write a field it does not own
 * through the bridge; a rogue write has to come from somewhere else, and the referee
 * reports it as one.
 */
@RestResource(urlMapping='/sync/v1/*')
global with sharing class SyncInboundResource {
    global class Payload {
        global String field;
        global String value;
    }

    @HttpPatch
    global static Map<String, Object> patch() {
        RestRequest request = RestContext.request;
        List<String> parts = request.requestURI.substringAfter('/sync/v1/').split('/');
        if (parts.size() != 2) {
            return reject(400, 'expected /sync/v1/<Object>/<Id>');
        }
        String objectName = parts[0];
        Id recordId;
        try {
            recordId = Id.valueOf(parts[1]);
        } catch (StringException e) {
            return reject(400, 'not a record Id: ' + parts[1]);
        }
        Payload payload = (Payload) JSON.deserialize(request.requestBody.toString(), Payload.class);
        if (!SyncContract.fieldsFor(objectName).contains(payload.field)) {
            return reject(422, payload.field + ' is not a contract field of ' + objectName);
        }
        SObject record = Schema.getGlobalDescribe().get(objectName).newSObject(recordId);
        record.put(payload.field, payload.value);
        update record;
        return new Map<String, Object>{ 'status' => 200, 'id' => recordId, 'field' => payload.field };
    }

    private static Map<String, Object> reject(Integer status, String message) {
        RestContext.response.statusCode = status;
        return new Map<String, Object>{ 'status' => status, 'error' => message };
    }
}
