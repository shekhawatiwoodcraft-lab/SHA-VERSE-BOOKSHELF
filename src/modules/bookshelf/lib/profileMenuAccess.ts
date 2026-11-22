export interface ProfileMenuVisibility {
  showYourChannel: true;
  showLibraryWorkspace: boolean;
  showAccountSettings: boolean;
  showAdminPanel: boolean;
  showLogout: true;
  showAccountDetails: true;
}

/**
 * Pure visibility policy for the Bookshelf profile dropdown menu.
 *
 * - All signed-in users see: Your Channel, Logout, and their login account details.
 * - Only the App Owner (owner email or admin role) sees: Library Workspace,
 *   Account & Settings, and Admin Panel.
 */
export function getProfileMenuVisibility(isAppOwner: boolean): ProfileMenuVisibility {
  const ownerOnly = Boolean(isAppOwner);
  return {
    showYourChannel: true,
    showLibraryWorkspace: ownerOnly,
    showAccountSettings: ownerOnly,
    showAdminPanel: ownerOnly,
    showLogout: true,
    showAccountDetails: true,
  };
}
