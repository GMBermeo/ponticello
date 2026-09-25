import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';

import {
  AppCredits, filterLibraryRows, LibraryEmptyState, LibraryHeader, LibraryTopBar,
  LibraryRowSeparator, PracticeRail, routeForRow, Screen, SongRow,
  type CategoryFilter, type DifficultyFilter,
} from '@components';
import { LIBRARY_ROWS, mergeChordLibrary, type LibraryRow } from '@scores';
import { useImportedRows } from '@state';
import { useTheme } from '@theme';

const keyExtractor = (row: LibraryRow) => row.id;

export default function LibraryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const imported = useImportedRows();
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('ALL');
  const [search, setSearch] = useState('');

  const allRows = useMemo(() => mergeChordLibrary([...imported, ...LIBRARY_ROWS]), [imported]);
  const importedIds = useMemo(() => new Set(imported.map((row) => row.id)), [imported]);
  const rows = useMemo(
    () => filterLibraryRows(allRows, { category, difficulty, search, importedIds }),
    [allRows, category, difficulty, search, importedIds],
  );
  const wide = !theme.scale.compact;

  const clearFilters = () => {
    setCategory('ALL');
    setDifficulty('ALL');
    setSearch('');
  };
  const openRow = (id: string) => {
    const row = allRows.find((candidate) => candidate.id === id);
    router.push(routeForRow(row, id, category));
  };

  return (
    <Screen scroll={false} padded={false}>
      <LibraryTopBar totalCount={allRows.length} />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <FlatList
            ListHeaderComponent={
              <LibraryHeader
                shownCount={rows.length}
                showShortcuts={!wide}
                search={search}
                onSearchChange={setSearch}
                category={category}
                onCategoryChange={setCategory}
                difficulty={difficulty}
                onDifficultyChange={setDifficulty}
              />
            }
            data={rows}
            keyExtractor={keyExtractor}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: theme.s(16), paddingBottom: theme.s(20) }}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={5}
            removeClippedSubviews
            renderItem={({ item }) => <SongRow row={item} onSelect={openRow} />}
            ItemSeparatorComponent={LibraryRowSeparator}
            ListFooterComponent={<AppCredits />}
            ListEmptyComponent={
              <LibraryEmptyState noImportsYet={category === 'imported' && !search} onClearFilters={clearFilters} />
            }
          />
        </View>
        {wide ? <PracticeRail /> : null}
      </View>
    </Screen>
  );
}
