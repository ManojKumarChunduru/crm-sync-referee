/**
 * The field lists the bridge syncs, one per object, and the identity it writes under.
 *
 * Why this class exists: the publisher triggers, the outbound service and the inbound
 * resource must agree on which fields cross the bridge. The same lists are the
 * contract/sync-contract.json the offline referee reads; keeping them in one Apex
 * class means a field added here and not there shows up as "contract silent" in the
 * referee's report rather than as a silent sync.
 */
public with sharing class SyncContract {
    public static final Set<String> ACCOUNT_FIELDS = new Set<String>{
        'Name', 'Phone', 'Industry', 'BillingCountry', 'AccountNumber', 'Website', 'Rating'
    };
    public static final Set<String> CONTACT_FIELDS = new Set<String>{
        'Email', 'Phone', 'Title', 'MailingCountry', 'Department', 'ERP_Status__c', 'LeadSource'
    };

    /** The integration user the bridge runs as; a change it commits is an echo of the ERP, not a user's decision. */
    public static final String INTEGRATION_USER_ID = '005Kd000000SYNCAAA';

    public static Set<String> fieldsFor(String objectName) {
        if (objectName == 'Account') return ACCOUNT_FIELDS;
        if (objectName == 'Contact') return CONTACT_FIELDS;
        return new Set<String>();
    }

    public static Boolean isBridgeUser() {
        return UserInfo.getUserId() == INTEGRATION_USER_ID;
    }
}
