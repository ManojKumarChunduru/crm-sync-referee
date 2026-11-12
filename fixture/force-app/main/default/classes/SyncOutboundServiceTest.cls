@IsTest
private class SyncOutboundServiceTest {
    private class ErpMock implements HttpCalloutMock {
        private Integer status;
        ErpMock(Integer status) { this.status = status; }
        public HttpResponse respond(HttpRequest request) {
            System.assert(request.getEndpoint().startsWith('callout:External_CRM/api/v1/'), 'goes through the named credential');
            System.assertEquals('PATCH', request.getMethod());
            HttpResponse response = new HttpResponse();
            response.setStatusCode(status);
            response.setBody(status == 200 ? '{"ok":true}' : '{"error":"rate_limited"}');
            return response;
        }
    }

    private static List<Sync_Change__e> oneEvent() {
        return new List<Sync_Change__e>{ new Sync_Change__e(
            Record_Id__c = '001Kd0000000001AAA', Object_Name__c = 'Account', Field_Name__c = 'Name',
            New_Value__c = 'New Name', Source_User__c = UserInfo.getUserId(), Occurred_At__c = System.now()) };
    }

    @IsTest
    static void aSuccessCountsAsApplied() {
        Test.setMock(HttpCalloutMock.class, new ErpMock(200));
        SyncOutboundService.ApplyResult result = SyncOutboundService.apply(oneEvent());
        System.assertEquals(1, result.applied);
        System.assertEquals(0, result.rejected);
    }

    @IsTest
    static void aRejectionIsCountedWithItsStatus() {
        Test.setMock(HttpCalloutMock.class, new ErpMock(429));
        SyncOutboundService.ApplyResult result = SyncOutboundService.apply(oneEvent());
        System.assertEquals(1, result.rejected);
        System.assert(result.errors[0].contains('429'), 'the status is kept for the operator');
    }

    @IsTest
    static void entityNamesFollowTheErpApi() {
        System.assertEquals('accounts', SyncOutboundService.entityFor('Account'));
        System.assertEquals('contacts', SyncOutboundService.entityFor('Contact'));
    }
}
