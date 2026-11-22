import { describe, it, expect } from 'vitest';
import { getProfileMenuVisibility } from './profileMenuAccess';

describe('getProfileMenuVisibility', () => {
  it('shows only Your Channel, Logout, and Account Details for regular users', () => {
    expect(getProfileMenuVisibility(false)).toEqual({
      showYourChannel: true,
      showLibraryWorkspace: false,
      showAccountSettings: false,
      showAdminPanel: false,
      showLogout: true,
      showAccountDetails: true,
    });
  });

  it('shows Library Workspace, Account & Settings, and Admin Panel only to the app owner', () => {
    expect(getProfileMenuVisibility(true)).toEqual({
      showYourChannel: true,
      showLibraryWorkspace: true,
      showAccountSettings: true,
      showAdminPanel: true,
      showLogout: true,
      showAccountDetails: true,
    });
  });
});
