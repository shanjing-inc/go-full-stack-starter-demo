import { gql } from "@apollo/client";
import type { TypedDocumentNode } from "@apollo/client";
import type {
    GetMemberShopQuery,
    GetMemberShopQueryVariables,
    MemberSignInMutation,
    MemberSignInMutationVariables,
    MemberSignOutMutation,
    MemberSignOutMutationVariables,
} from "./generated";

export const GET_MEMBER_SHOP: TypedDocumentNode<GetMemberShopQuery, GetMemberShopQueryVariables> =
    gql`
        query GetMemberShop($where: ShopFilters!) {
            getShop(where: $where) {
                id
                name
                slug
                status
                createdAt
                updatedAt
            }
        }
    `;

export const MEMBER_SIGN_IN: TypedDocumentNode<
    MemberSignInMutation,
    MemberSignInMutationVariables
> = gql`
    mutation MemberSignIn($input: MemberSignInInput!) {
        signInWithEmail(input: $input) {
            token
        }
    }
`;
export const MEMBER_SIGN_OUT: TypedDocumentNode<
    MemberSignOutMutation,
    MemberSignOutMutationVariables
> = gql`
    mutation MemberSignOut {
        signOut
    }
`;
