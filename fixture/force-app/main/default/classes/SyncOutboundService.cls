/**
 * Applies Sync_Change__e events to the ERP over its REST API through the
 * External_CRM named credential.
 *
 * Why this class exists: the callout carries no token handling at all, because the
 * named credential and its external credential (OAuth 2.0 client credentials) add the
 * Authorization header; the class only shapes the request. The same flow, written by
 * hand over fetch, is src/csr/http_client.js on the referee's side.
 */
public with sharing class SyncOutboundService {
    public class ApplyResult {
        public Integer applied = 0;
        public Integer rejected = 0;
        public List<String> errors = new List<String>();
    }

    public static ApplyResult apply(List<Sync_Change__e> events) {
        ApplyResult result = new ApplyResult();
        for (Sync_Change__e event : events) {
            HttpRequest request = new HttpRequest();
            request.setEndpoint('callout:External_CRM/api/v1/' + entityFor(event.Object_Name__c) + '/by-sf-id/' + event.Record_Id__c);
            request.setMethod('PATCH');
            request.setHeader('Content-Type', 'application/json');
            request.setHeader('Idempotency-Key', event.ReplayId);
            request.setBody(JSON.serialize(new Map<String, Object>{
                'field' => event.Field_Name__c,
                'value' => event.New_Value__c,
                'occurred_at' => event.Occurred_At__c,
                'source_user' => event.Source_User__c
            }));
            HttpResponse response = new Http().send(request);
            if (response.getStatusCode() >= 200 && response.getStatusCode() < 300) {
                result.applied += 1;
            } else {
                result.rejected += 1;
                result.errors.add(event.ReplayId + ': ' + response.getStatusCode() + ' ' + response.getBody());
            }
        }
        return result;
    }

    @TestVisible
    private static String entityFor(String objectName) {
        return objectName == 'Account' ? 'accounts' : 'contacts';
    }
}
