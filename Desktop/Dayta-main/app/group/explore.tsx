import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

import {
  buildGroupDiscoveryBuckets,
  filterAndRankDiscoverableGroups,
  GroupDiscoveryCategory,
  GroupDiscoverySummary,
  subscribeDiscoverableGroups,
  subscribeDiscoverableGroupsByCategory,
} from "../../services/groups";

type ExploreGroupsStyles = ReturnType<typeof makeStyles>;

function formatDiscoveryRelativeTime(ms?: number | null): string {
  if (!ms) return "Recently";

  const diffMs = Date.now() - ms;
  const diffMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(ms).toLocaleDateString();
}

function getDiscoveryActivityLabel(group: GroupDiscoverySummary): string {
  if (group.lastActivityAtMs) {
    return `Active ${formatDiscoveryRelativeTime(group.lastActivityAtMs)}`;
  }

  if (group.createdAtMs) {
    return `Created ${formatDiscoveryRelativeTime(group.createdAtMs)}`;
  }

  return "Recently active";
}

function getJoinPolicyLabel(
  joinPolicy: GroupDiscoverySummary["joinPolicy"]
): string {
  switch (joinPolicy) {
    case "open":
      return "Open join";
    case "request":
      return "Request to join";
    default:
      return "Invite only";
  }
}

const CATEGORY_OPTIONS: Array<{
  key: "all" | GroupDiscoveryCategory;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "general", label: "General" },
  { key: "fitness", label: "Fitness" },
  { key: "productivity", label: "Productivity" },
  { key: "learning", label: "Learning" },
  { key: "wellness", label: "Wellness" },
  { key: "work", label: "Work" },
  { key: "other", label: "Other" },
];

export default function ExploreGroupsScreen() {
    const { themeId: selectedThemeId } = useCurrentAppTheme();
const theme = useAppTheme(selectedThemeId);
const styles = useMemo(() => makeStyles(theme), [theme]);
  const [groups, setGroups] = useState<GroupDiscoverySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<"all" | GroupDiscoveryCategory>("all");

React.useEffect(() => {
  setLoading(true);

  const handleNext = (nextGroups: GroupDiscoverySummary[]) => {
    setGroups(nextGroups);
    setLoading(false);
    setError(null);
  };

  const handleError = (err: unknown) => {
    console.log("[ExploreGroups] subscribe failed", err);
    setLoading(false);
    setError("Failed to load groups.");
  };

  const unsub =
    selectedCategory === "all"
      ? subscribeDiscoverableGroups(handleNext, handleError)
      : subscribeDiscoverableGroupsByCategory(
          selectedCategory,
          handleNext,
          handleError
        );

  return unsub;
}, [selectedCategory]);

  const filteredGroups = useMemo(() => {
  return filterAndRankDiscoverableGroups(groups, searchText);
}, [groups, searchText]);

  const buckets = useMemo(() => {
    return buildGroupDiscoveryBuckets(filteredGroups);
  }, [filteredGroups]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
  <Ionicons name="chevron-back" size={18} color={theme.colors.primary} />
  <Text style={styles.backButtonText}>Groups</Text>
</Pressable>

<View style={styles.header}>
  <Text style={styles.title}>Explore Groups</Text>

  <Text style={styles.subtitle}>
    Discover public accountability communities.
  </Text>
</View>

        <TextInput
  value={searchText}
  onChangeText={setSearchText}
  placeholder="Search groups"
  placeholderTextColor={theme.colors.textMuted}
  style={styles.searchInput}
/>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
        >
          {CATEGORY_OPTIONS.map((option) => {
            const selected = selectedCategory === option.key;

            return (
              <Pressable
                key={option.key}
                onPress={() => setSelectedCategory(option.key)}
                style={[
                  styles.categoryChip,
                  selected && styles.categoryChipSelected,
                ]}
              >
                <Text
                  style={[
                    styles.categoryChipText,
                    selected && styles.categoryChipTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.stateText}>Loading groups...</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : filteredGroups.length === 0 ? (
          <View style={styles.centerState}>
            <Text style={styles.stateTitle}>No matching groups</Text>

<Text style={styles.stateText}>
  Try a different search, choose another category, or check back as more public groups are created.
</Text>

<Pressable
  style={styles.resetFiltersButton}
  onPress={() => {
    setSearchText("");
    setSelectedCategory("all");
  }}
>
  <Text style={styles.resetFiltersButtonText}>Reset filters</Text>
</Pressable>
          </View>
        ) : (
          <>
           <ExploreSection
  title="Recommended"
  groups={buckets.recommended}
  emptyText="Recommended groups will appear here as discovery grows."
  styles={styles}
/>

<ExploreSection
  title="Trending"
  groups={buckets.trending}
  emptyText="Trending groups will appear once communities become active."
  styles={styles}
/>

<ExploreSection
  title="Newest"
  groups={buckets.newest}
  emptyText="Newly discoverable groups will appear here."
  styles={styles}
/>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ExploreSection({
  title,
  groups,
  emptyText,
  styles,
}: {
  title: string;
  groups: GroupDiscoverySummary[];
  emptyText: string;
  styles: ExploreGroupsStyles;
}) {

  return (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>

    {groups.length === 0 ? (
      <View style={styles.sectionEmptyCard}>
        <Text style={styles.sectionEmptyText}>{emptyText}</Text>
      </View>
    ) : (
      groups.map((group) => (
        <Pressable
          key={group.id}
          style={styles.groupCard}
          onPress={() => {
            router.push({
  pathname: "/group/[id]/preview",
  params: { id: group.id },
});
          }}
        >
          <View style={styles.groupCardHeader}>
            <Text style={styles.groupName} numberOfLines={1}>
              {group.name}
            </Text>

            <View style={styles.groupStatsPill}>
  <Ionicons
    name="people-outline"
    size={13}
    color={styles.metaIconColor.color}
  />
  <Text style={styles.groupStatsPillText}>
    {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
  </Text>
</View>
          </View>

          {!!group.summary ? (
            <Text style={styles.groupSummary} numberOfLines={2}>
              {group.summary}
            </Text>
          ) : null}

          <View style={styles.activityMetaRow}>
  <Ionicons
    name="time-outline"
    size={13}
    color={styles.metaIconColor.color}
  />
  <Text style={styles.activityMetaText}>
    {getDiscoveryActivityLabel(group)}
  </Text>
</View>

          <View style={styles.groupMetaRow}>
            <Text style={styles.groupCategory}>
              {group.category}
            </Text>

            <View
  style={[
    styles.joinPolicyBadge,
    group.joinPolicy === "open"
      ? styles.joinPolicyBadgeOpen
      : group.joinPolicy === "request"
      ? styles.joinPolicyBadgeRequest
      : styles.joinPolicyBadgeInviteOnly,
  ]}
>
  <Text
    style={[
      styles.joinPolicyBadgeText,
      group.joinPolicy === "open"
        ? styles.joinPolicyBadgeTextOpen
        : group.joinPolicy === "request"
        ? styles.joinPolicyBadgeTextRequest
        : styles.joinPolicyBadgeTextInviteOnly,
    ]}
  >
    {getJoinPolicyLabel(group.joinPolicy)}
  </Text>
</View>
          </View>

          {group.tags.length > 0 ? (
            <View style={styles.tagsRow}>
              {group.tags.slice(0, 4).map((tag) => (
                <View key={tag} style={styles.tagChip}>
                  <Text style={styles.tagText}>#{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>
            ))
    )}
  </View>
);
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },

    content: {
      padding: 20,
      paddingTop: 70,
      paddingBottom: 120,
    },

    title: {
      color: theme.colors.text,
      fontSize: 32,
      fontWeight: "900",
    },

    subtitle: {
      color: theme.colors.textMuted,
      marginTop: 8,
      fontSize: 15,
      lineHeight: 21,
    },

    searchInput: {
      marginTop: 0,
      backgroundColor: theme.colors.inputBackground,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: theme.colors.text,
      fontSize: 15,
    },

    categoryChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.colors.surfaceMuted,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },

    categoryChipSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },

    categoryChipText: {
      color: theme.colors.textMuted,
      fontWeight: "800",
      fontSize: 13,
    },

    categoryChipTextSelected: {
      color: theme.colors.primaryText,
    },

    groupCard: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 18,
      padding: 16,
      marginBottom: 14,
    },

    groupName: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 17,
      fontWeight: "900",
      marginRight: 10,
    },

    memberCount: {
      color: theme.colors.textMuted,
      fontSize: 12,
      fontWeight: "700",
    },

    groupSummary: {
      marginTop: 10,
      color: theme.colors.textMuted,
      lineHeight: 20,
    },

    groupCategory: {
      color: theme.colors.primary,
      fontWeight: "800",
      textTransform: "capitalize",
    },

    groupJoinPolicy: {
      color: theme.colors.textMuted,
      fontSize: 13,
      fontWeight: "700",
    },

    tagChip: {
      backgroundColor: theme.colors.badge,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },

    tagText: {
      color: theme.colors.badgeText,
      fontSize: 12,
      fontWeight: "800",
    },

  categoryRow: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 10,
  },




  centerState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },

stateTitle: {
  color: theme.colors.text,
  fontSize: 18,
  fontWeight: "900",
},

stateText: {
  marginTop: 8,
  color: theme.colors.textMuted,
  textAlign: "center",
},

errorText: {
  color: theme.colors.danger,
  textAlign: "center",
  fontWeight: "800",
},
  section: {
    marginTop: 28,
  },

 sectionTitle: {
  color: theme.colors.text,
  fontSize: 20,
  fontWeight: "900",
  marginBottom: 14,
},

  groupCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  
  groupMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },

 
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 14,
  },
backButton: {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  alignSelf: "flex-start",
  marginBottom: 18,
},

backButtonText: {
  color: theme.colors.primary,
  fontWeight: "800",
  fontSize: 15,
},

header: {
  marginBottom: 18,
},
  joinPolicyBadge: {
  borderWidth: 1,
  borderRadius: 999,
  paddingHorizontal: 8,
  paddingVertical: 4,
},

joinPolicyBadgeOpen: {
  backgroundColor: theme.colors.successBackground,
  borderColor: theme.colors.successBorder,
},

joinPolicyBadgeRequest: {
  backgroundColor: theme.colors.warningBackground,
  borderColor: theme.colors.warningBorder,
},

joinPolicyBadgeInviteOnly: {
  backgroundColor: theme.colors.secondaryBackground,
  borderColor: theme.colors.secondaryBorder,
},

joinPolicyBadgeText: {
  fontSize: 12,
  fontWeight: "900",
},

joinPolicyBadgeTextOpen: {
  color: theme.colors.successText,
},

joinPolicyBadgeTextRequest: {
  color: theme.colors.warningText,
},

joinPolicyBadgeTextInviteOnly: {
  color: theme.colors.secondaryText,
},
metaIconColor: {
  color: theme.colors.textMuted,
},

groupStatsPill: {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
  paddingHorizontal: 8,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: theme.colors.surfaceMuted,
},

groupStatsPillText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},
activityMetaRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 5,
  marginTop: 10,
},

activityMetaText: {
  color: theme.colors.textMuted,
  fontSize: 12,
  fontWeight: "800",
},
sectionEmptyCard: {
  padding: 14,
  borderRadius: 16,
  backgroundColor: theme.colors.surface,
  borderColor: theme.colors.border,
  borderWidth: 1,
},

sectionEmptyText: {
  color: theme.colors.textMuted,
  fontSize: 13,
  lineHeight: 19,
  fontWeight: "700",
},
resetFiltersButton: {
  marginTop: 14,
  paddingHorizontal: 14,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: theme.colors.badge,
  borderColor: theme.colors.primary,
  borderWidth: 1,
},

resetFiltersButtonText: {
  color: theme.colors.primary,
  fontSize: 13,
  fontWeight: "900",
},
  });