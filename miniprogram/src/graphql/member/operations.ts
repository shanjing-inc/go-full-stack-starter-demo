import { gql } from "@apollo/client";
import type { TypedDocumentNode } from "@apollo/client";
import type { GetMemberShopQuery, GetMemberShopQueryVariables } from "./generated";

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
