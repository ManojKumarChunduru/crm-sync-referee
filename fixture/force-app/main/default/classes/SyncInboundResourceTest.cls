@IsTest
private class SyncInboundResourceTest {
    private static Map<String, Object> call(String uri, String body) {
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        RestContext.request.requestURI = uri;
        RestContext.request.httpMethod = 'PATCH';
        RestContext.request.requestBody = Blob.valueOf(body);
        return SyncInboundResource.patch();
    }

    @IsTest
    static void aContractFieldIsWritten() {
        Account account = new Account(Name = 'Before');
        insert account;
        Map<String, Object> result = call('/services/apexrest/sync/v1/Account/' + account.Id, '{"field":"Name","value":"After"}');
        System.assertEquals(200, result.get('status'));
        System.assertEquals('After', [SELECT Name FROM Account WHERE Id = :account.Id].Name);
    }

    @IsTest
    static void aFieldOutsideTheContractIsRefused() {
        Account account = new Account(Name = 'Before');
        insert account;
        Map<String, Object> result = call('/services/apexrest/sync/v1/Account/' + account.Id, '{"field":"Description","value":"x"}');
        System.assertEquals(422, result.get('status'));
        System.assertEquals(422, RestContext.response.statusCode);
    }

    @IsTest
    static void aMalformedPathIsRefused() {
        Map<String, Object> result = call('/services/apexrest/sync/v1/Account', '{"field":"Name","value":"x"}');
        System.assertEquals(400, result.get('status'));
    }
}
