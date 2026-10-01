import { useMemo } from "react";
import { QueryClient, useQuery } from "@tanstack/react-query";

import { Announcement } from "shared/types/Announcement";

function useAnnouncement() {
    const queryClient = useMemo(() => new QueryClient(), []);

    const { data: announcement, status, refetch } = useQuery({
        queryKey: ["announcement"],
        queryFn: async () => {
            const announcementResponse = await fetch("/api/public/announcement");
            if (announcementResponse.status == 204) return null;
            if (!announcementResponse.ok) throw new Error();
            return await announcementResponse.json() as Announcement;
        },
        retry: false,
        refetchOnWindowFocus: false
    }, queryClient);

    if (status != "success" || !announcement) return { status, refetch };

    return {
        status,
        refetch,
        announcement
    };
}

export default useAnnouncement;